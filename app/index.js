var csInterface = new CSInterface();

const HOST = 'localhost';
const MODEL = 'lama';
const DEVICE = 'cuda';
const PORT = '7458';
const API_GENERATIVE_FILL = '/api/v1/inpaint';
const API_SERVER_CONFIG = '/api/v1/server-config';

const CHECK_INTERVAL = 2000;

let serverAvailable = false;

document.addEventListener("DOMContentLoaded", function () {
    const genFillButton = document.getElementById("genFill");
    const startServerButton = document.getElementById("startServer");

    startServerButton.addEventListener("click", function () {
        csInterface.evalScript(`startServer("${MODEL}", "${DEVICE}", "${PORT}")`);
    });

    genFillButton.addEventListener("click", generativeFill);

    startServerStatusPolling();
});

function generativeFill() {
    if (!serverAvailable) {
        alert("Сервер недоступен. Запустите сервер перед использованием функции.");
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

        csInterface.evalScript(`saveImageAndMask("${imagePathPNG}","${maskPathPNG}","${resultPath}")`, function () {
            const b64_img = imageToBase64(imagePathPNG);
            const b64_mask = imageToBase64(maskPathPNG);

            const data = {
                image: b64_img,
                mask: b64_mask
            };

            fetch(`http://${HOST}:${PORT}${API_GENERATIVE_FILL}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
                .then(response => response.arrayBuffer())
                .then(buffer => {
                    const uint8Array = new Uint8Array(buffer);
                    const binaryString = uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), '');
                    const val = window.btoa(binaryString);
                    window.cep.fs.writeFile(resultPath + ".png", val, cep.encoding.Base64);

                    csInterface.evalScript(`placeImageAsRaster("${resultPath}")`);
                })
                .catch(error => {
                    alert("IOPaint API error - " + API_GENERATIVE_FILL + ": " + error);
                })
                .finally(() => {
                    csInterface.evalScript(`deleteFile("${imagePathPNG}")`);
                    csInterface.evalScript(`deleteFile("${maskPathPNG}")`);
                    csInterface.evalScript(`deleteFile("${resultPath}.png")`);
                    csInterface.evalScript(`deleteFile("${resultPath}.txt")`);
                });
        });
    });
}

function imageToBase64(filePath) {
    var fileResult = window.cep.fs.readFile(filePath, cep.encoding.Base64);
    if (fileResult.err !== 0) {
        throw new Error('File read error: ' + fileResult.err);
    }
    return fileResult.data;
}

function startServerStatusPolling() {
    const indicator = document.getElementById("statusIndicator");
    const text = document.getElementById("statusText");
    const genFillButton = document.getElementById("genFill");
    const startServerButton = document.getElementById("startServer");

    async function checkServer() {
        try {
            const response = await fetch(`http://${HOST}:${PORT}${API_SERVER_CONFIG}`, { method: 'GET' });
            if (response.ok) {
                serverAvailable = true;
                indicator.style.backgroundColor = "limegreen";
                text.textContent = "Сервер подключен";
                genFillButton.disabled = false;
                startServerButton.style.display = 'none';
            } else {
                setServerOffline("Ошибка соединения (" + response.status + ")");
            }
        } catch (e) {
            setServerOffline("Сервер недоступен");
        }
    }

    function setServerOffline(msg) {
        serverAvailable = false;
        indicator.style.backgroundColor = "red";
        text.textContent = msg;
        genFillButton.disabled = true;
        startServerButton.style.display = 'flex';
    }

    checkServer();
    setInterval(checkServer, CHECK_INTERVAL);
}

function checkSelectionAvailable(callback) {
    csInterface.evalScript(
        `try { var b = app.activeDocument.selection.bounds; "true"; } catch(e) { "false"; }`,
        function (result) {
            callback(result === "true");
        }
    );
}