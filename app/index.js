var csInterface = new CSInterface();

const HOST = 'localhost';
const MODEL = 'lama';
const PORT = '7458';
const API_GENERATIVE_FILL = '/api/v1/inpaint';
const API_SERVER_CONFIG = '/api/v1/server-config';
const CHECK_INTERVAL = 2000;

let serverAvailable = false;
let DEVICE = localStorage.getItem('device') || 'cpu';

document.addEventListener("DOMContentLoaded", function () {

    const genFillButton = document.getElementById("genFill");
    const startServerButton = document.getElementById("startServer");
    const openSettingsButton = document.getElementById("openSettings");
    const mainView = document.getElementById("mainView");
    const settingsView = document.getElementById("settingsView");
    const deviceSelect = document.getElementById("deviceSelect");
    const backButton = document.getElementById("backButton");

    deviceSelect.value = DEVICE;
    startServerButton.textContent = `Запустить сервер (${DEVICE === "cuda" ? "GPU" : "CPU"})`;

    genFillButton.addEventListener("click", generativeFill);

    startServerButton.addEventListener("click", function () {
        callScript("startServer", [MODEL, DEVICE, PORT]);
    });

    openSettingsButton.addEventListener("click", function () {
        mainView.style.display = "none";
        settingsView.style.display = "block";
    });

    backButton.addEventListener("click", function () {
        settingsView.style.display = "none";
        mainView.style.display = "block";
    });

    deviceSelect.addEventListener("change", function () {
        DEVICE = this.value;
        startServerButton.textContent = `Запустить сервер (${DEVICE === "cuda" ? "GPU" : "CPU"})`;
        localStorage.setItem("device", DEVICE);
    });

    startServerStatusPolling();
});

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

        var extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
        var timestamp = Date.now();
        var imagePathPNG = extensionPath + "/app/image_" + timestamp + ".png";
        var maskPathPNG = extensionPath + "/app/mask_" + timestamp + ".png";
        var resultPath = extensionPath + "/app/result_" + timestamp;

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
                    alert("IOPaint API error: " + err);
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

    function setStatus(status, msg) {
        if (status === 1) {
            serverAvailable = true;
            indicator.style.backgroundColor = "limegreen";
            text.textContent = "Сервер подключен";
            genFillButton.disabled = false;
            startServerButton.style.display = "none";
        } else {
            serverAvailable = false;
            indicator.style.backgroundColor = "red";
            text.textContent = msg || "Сервер недоступен";
            genFillButton.disabled = true;
            startServerButton.style.display = "flex";
        }
    }

    async function checkServer() {
        try {
            const response = await fetch(
                `http://${HOST}:${PORT}${API_SERVER_CONFIG}`
            );

            response.ok
                ? setStatus(1)
                : setStatus(0, "Ошибка соединения");

        } catch (e) {
            setStatus(0, "Сервер недоступен");
        }
    }

    checkServer();
    setInterval(checkServer, CHECK_INTERVAL);
}
