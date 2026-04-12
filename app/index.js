var csInterface = new CSInterface();

const HOST = 'localhost';
const PORT = '7458';
const API_GENERATIVE_FILL = '/inpaint';
const API_HEALTH = '/health';
const CHECK_INTERVAL = 2000;

var EXTENSION_PATH = csInterface.getSystemPath(SystemPath.EXTENSION);
let DEVICE = localStorage.getItem('device') || 'cpu';
let MODEL = localStorage.getItem('model') || 'lama';
let LOG_HEALTH = localStorage.getItem("logHealth") || "false";
let serverAvailable = false;

document.addEventListener("DOMContentLoaded", function () {
    const genFillButton = document.getElementById("genFill");
    const startServerButton = document.getElementById("startServer");
    const openSettingsButton = document.getElementById("openSettings");
    const mainView = document.getElementById("mainView");
    const settingsView = document.getElementById("settingsView");
    const deviceSelect = document.getElementById("deviceSelect");
    const modelSelect = document.getElementById("modelSelect");
    const logHealthSelect = document.getElementById("logHealthSelect");
    const backButton = document.getElementById("backButton");

    deviceSelect.value = DEVICE;
    startServerButton.textContent = `Запустить сервер (${DEVICE === "cuda" ? "GPU" : "CPU"}, ${MODEL})`;

    logHealthSelect.value = LOG_HEALTH;

    genFillButton.addEventListener("click", generativeFill);

    startServerButton.addEventListener("click", function () {
        callScript("startServer", [EXTENSION_PATH + '/app/server.py', MODEL, DEVICE, PORT, LOG_HEALTH]);
    });

    openSettingsButton.addEventListener("click", function () {
        loadAvailableModels();
        mainView.style.display = "none";
        settingsView.style.display = "block";
    });

    backButton.addEventListener("click", function () {
        settingsView.style.display = "none";
        mainView.style.display = "block";
    });

    deviceSelect.addEventListener("change", function () {
        DEVICE = this.value;
        localStorage.setItem("device", DEVICE);
        updateStartButtonText();
    });

    modelSelect.addEventListener("change", function () {
        MODEL = this.value;
        localStorage.setItem("model", MODEL);
        updateStartButtonText();
    });

    logHealthSelect.addEventListener("change", function () {
        LOG_HEALTH = this.value;
        localStorage.setItem("logHealth", LOG_HEALTH);
    });

    startServerStatusPolling();
    loadAvailableModels();
});

function updateStartButtonText() {
    const startServerButton = document.getElementById("startServer");

    startServerButton.textContent =
        `Запустить сервер (${DEVICE === "cuda" ? "GPU" : "CPU"}, ${MODEL})`;
}

function generativeFill() {
    if (!serverAvailable) {
        alert("Сервер недоступен. Запустите сервер.");
        return;
    }

    checkSelectionAvailable(function (hasSelection) {
        if (!hasSelection) {
            alert("Отсутствует область выделения");
            return;
        }

        var timestamp = Date.now();
        var imagePathPNG = EXTENSION_PATH + "/app/image_" + timestamp + ".png";
        var maskPathPNG = EXTENSION_PATH + "/app/mask_" + timestamp + ".png";
        var resultPath = EXTENSION_PATH + "/app/result_" + timestamp;

        callScript(
            "saveImageAndMask",
            [imagePathPNG, maskPathPNG, resultPath],
            function () {

                const b64_img = imageToBase64(imagePathPNG);
                const b64_mask = imageToBase64(maskPathPNG);

                fetch(`http://${HOST}:${PORT}${API_GENERATIVE_FILL}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        image: b64_img,
                        mask: b64_mask
                    })
                })
                    .then(r => r.arrayBuffer())
                    .then(buffer => {
                        const uint8Array = new Uint8Array(buffer);
                        const binaryString = uint8Array.reduce(
                            (data, byte) => data + String.fromCharCode(byte), ""
                        );

                        const base64 = window.btoa(binaryString);
                        window.cep.fs.writeFile(
                            resultPath + ".png",
                            base64,
                            cep.encoding.Base64
                        );

                        callScript("placeImageAsRaster", [resultPath]);
                    })
                    .catch(err => {
                        alert("Inpainting API error: " + err);
                    })
                    .finally(() => {
                        callScript("deleteFile", [imagePathPNG]);
                        callScript("deleteFile", [maskPathPNG]);
                        callScript("deleteFile", [resultPath + ".png"]);
                        callScript("deleteFile", [resultPath + ".txt"]);
                    });
            }
        );
    });
}

function callScript(method, args, callback) {
    const formattedArgs = (args || [])
        .map(arg => `"${String(arg).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",");

    const script = `${method}(${formattedArgs})`;

    csInterface.evalScript(script, callback);
}

function imageToBase64(filePath) {
    const result = window.cep.fs.readFile(filePath, cep.encoding.Base64);
    if (result.err !== 0) {
        throw new Error("File read error: " + result.err);
    }
    return result.data;
}

function checkSelectionAvailable(callback) {
    callScript(
        "eval",
        [`try { app.activeDocument.selection.bounds; "true"; } catch(e) { "false"; }`],
        result => callback(result === "true")
    );
}

function startServerStatusPolling() {
    const indicator = document.getElementById("statusIndicator");
    const text = document.getElementById("statusText");
    const genFillButton = document.getElementById("genFill");
    const startServerButton = document.getElementById("startServer");

    function setStatus(available, msg) {
        serverAvailable = available;
        if (available) {
            indicator.style.backgroundColor = "limegreen";
            text.textContent = "Сервер подключен";
            genFillButton.disabled = false;
            startServerButton.style.display = "none";
        } else {
            indicator.style.backgroundColor = "red";
            text.textContent = msg || "Сервер недоступен";
            genFillButton.disabled = true;
            startServerButton.style.display = "flex";
        }
    }

    async function checkServer() {
        try {
            const response = await fetch(`http://${HOST}:${PORT}${API_HEALTH}`, {
                method: "GET"
            });

            if (response.ok) {
                const data = await response.json();
                if (data.status === "ok") {
                    setStatus(true);
                    return;
                }
            }
            setStatus(false, "Сервер не отвечает корректно");
        } catch (e) {
            setStatus(false, "Сервер недоступен");
        }
    }

    checkServer();
    setInterval(checkServer, CHECK_INTERVAL);
}

function loadAvailableModels() {
    const modelSelect = document.getElementById("modelSelect");

    callScript("getAvailableModels", [EXTENSION_PATH], function (result) {
        const models = result
            .split(";")
            .filter(Boolean)
            .map(item => {
                const [name, label, installed] = item.split("|");

                return {
                    name,
                    label,
                    installed: installed === "1"
                };
            });

        modelSelect.innerHTML = "";

        models.forEach(m => {
            const option = document.createElement("option");
            option.value = m.name;
            option.textContent = m.installed? m.label : `${m.label} (не установлена)`;

            modelSelect.appendChild(option);
        });

        const saved = localStorage.getItem("model");

        if (saved) {
            modelSelect.value = saved;
        } else if (models.length > 0) {
            modelSelect.value = models[0].name;
        }

        MODEL = modelSelect.value;
    });
}