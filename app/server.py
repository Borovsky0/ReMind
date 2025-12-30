import os
import argparse
import base64
import io
from urllib.parse import urlparse
from urllib.request import urlopen, Request
import http.server
import socketserver
import json
import time
import datetime
import torch
import numpy as np
from PIL import Image

SUPPORTED_MODELS = {
    "lama": {
        "filename": "big-lama.pt",
        "url": "https://github.com/Borovsky0/models/releases/download/lama/big-lama.pt"
    },
}

def log(message: str, log_type: str = "INFO"):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if log_type == "INFO":
        color = "\033[94m" 
    elif log_type == "API":
        color = "\033[92m" 
    else:
        color = "\033[97m"
    print(f"\033[90m[{timestamp}]\033[0m {color}{log_type}\033[0m {message}")

def ceil_modulo(x: int, mod: int) -> int:
    return x if x % mod == 0 else (x // mod + 1) * mod

def pad_img_to_modulo(img: np.ndarray, mod: int) -> np.ndarray:
    channels, height, width = img.shape
    out_height = ceil_modulo(height, mod)
    out_width = ceil_modulo(width, mod)
    return np.pad(img, ((0, 0), (0, out_height - height), (0, out_width - width)), mode="symmetric")

def download_with_progress(url: str, dest_path: str):
    if os.path.exists(dest_path):
        return
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req) as response, open(dest_path, 'wb') as out_file:
        total_size = int(response.headers.get('Content-Length', 0))
        downloaded = 0
        block_size = 8192
        full_path = os.path.abspath(dest_path)
        if total_size:
            log(f"Downloading model ({total_size // (1024*1024)} MB) → {full_path}")
        else:
            log(f"Downloading model → {full_path}")
        while True:
            buffer = response.read(block_size)
            if not buffer:
                break
            out_file.write(buffer)
            downloaded += len(buffer)
            if total_size:
                percent = (downloaded / total_size) * 100
                mb_downloaded = downloaded // (1024*1024)
                mb_total = total_size // (1024*1024)
                print(f"\r\033[90m[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]\033[0m " f"\033[94mINFO\033[0m Progress: {percent:6.2f}%  ({mb_downloaded:3d} / {mb_total:3d} MB)", end="", flush=True)
        print()
        log("Download completed.")

class InpaintModel:
    def __init__(self, model_name: str, device: torch.device):
        if model_name not in SUPPORTED_MODELS:
            raise ValueError(f"Unsupported model: {model_name}. Available: {', '.join(SUPPORTED_MODELS.keys())}")

        config = SUPPORTED_MODELS[model_name]
        self.model_name = model_name

        script_dir = os.path.dirname(os.path.abspath(__file__))

        app_parent_dir = os.path.dirname(script_dir)
        models_dir = os.path.join(app_parent_dir, "models")
        os.makedirs(models_dir, exist_ok=True)

        local_path = os.path.join(models_dir, config["filename"])

        if not os.path.exists(local_path):
            download_with_progress(config["url"], local_path)

        self.model = torch.jit.load(local_path, map_location=device)
        self.model.eval()
        self.model.to(device)
        self.device = device
        self.model_path = os.path.abspath(local_path)

    def __call__(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        orig_size = image.size 
        img_np = np.array(image.convert("RGB")).astype(np.float32) / 255.0
        mask_np = np.array(mask.convert("L")).astype(np.float32) / 255.0

        img_np = np.transpose(img_np, (2, 0, 1))
        mask_np = mask_np[np.newaxis, ...]

        img_np = pad_img_to_modulo(img_np, 8)
        mask_np = pad_img_to_modulo(mask_np, 8)

        img_tensor = torch.from_numpy(img_np).unsqueeze(0).to(self.device)
        mask_tensor = torch.from_numpy(mask_np).unsqueeze(0).to(self.device)
        mask_tensor = (mask_tensor > 0.5).float()

        with torch.no_grad():
            result = self.model(img_tensor, mask_tensor)

        result_np = result[0].permute(1, 2, 0).cpu().numpy()
        result_np = np.clip(result_np * 255.0, 0, 255).astype(np.uint8)
        result_np = result_np[:orig_size[1], :orig_size[0]]

        return Image.fromarray(result_np)

class APIHandler(http.server.BaseHTTPRequestHandler):
    def __init__(self, *args, model=None, **kwargs):
        self.model = model
        super().__init__(*args, **kwargs)

    def _send_json(self, data: dict, status: int = 200):
        response = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        start_time = time.time()
        if self.path == "/health":
            self._send_json({"status": "ok", "message": "Server is running"})
            log(f"GET /health {time.time() - start_time:.3f}s", "API")
            return
        if self.path == "/models":
            models_info = [
                {
                    "name": name,
                    "installed": os.path.exists(os.path.join("models", cfg["filename"]))
                }
                for name, cfg in SUPPORTED_MODELS.items()
            ]
            self._send_json({"models": models_info})
            log(f"GET /models {time.time() - start_time:.3f}s", "API")
            return
        self.send_error(404, "Not Found")

    def do_POST(self):
        start_time = time.time()
        if self.path != "/inpaint":
            self.send_error(404, "Not Found")
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                raise ValueError("Empty body")
            post_data = json.loads(self.rfile.read(length))

            image = Image.open(io.BytesIO(base64.b64decode(post_data["image"])))
            mask = Image.open(io.BytesIO(base64.b64decode(post_data["mask"])))

            result_img = self.model(image, mask)

            buffer = io.BytesIO()
            result_img.save(buffer, format="PNG")
            png_data = buffer.getvalue()

            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png_data)))
            self.end_headers()
            self.wfile.write(png_data)

            log(f"POST /inpaint {time.time() - start_time:.3f}s", "API")
        except Exception as exc:
            log(f"POST /inpaint error: {exc}", "API")
            self.send_error(500, str(exc))

if __name__ == "__main__":
    start_time_script = time.time() 

    parser = argparse.ArgumentParser(description="Local inpainting API server")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    parser.add_argument("--model", default="lama",
                        help="Model name (available: " + ", ".join(SUPPORTED_MODELS.keys()) + ")")
    parser.add_argument("--device", default="cuda", choices=["cpu", "cuda"],
                        help="Device: cpu or cuda")
    args = parser.parse_args()

    device = torch.device("cuda" if args.device == "cuda" and torch.cuda.is_available() else "cpu")
    os.makedirs("models", exist_ok=True)

    inpaint_model = InpaintModel(args.model, device)

    log(f"Using device: {device} \033[90m(PyTorch {torch.__version__})\033[0m")
    log(f"Using model: {inpaint_model.model_name} \033[90m({inpaint_model.model_path})\033[0m")

    log(f"Server running on http://localhost:{args.port} \033[90m(Startup time: {(time.time() - start_time_script):.3f}s)\033[0m")

    handler = lambda *a, **kw: APIHandler(*a, model=inpaint_model, **kw)
    with socketserver.TCPServer(("", args.port), handler) as httpd:
        httpd.serve_forever()