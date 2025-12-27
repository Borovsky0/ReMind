function saveImageAndMask(imagePath, maskPath, resultPath) {
    app.activeDocument.suspendHistory("Save Image and Mask", "saveImageAndMaskImpl('" + imagePath + "','" + maskPath + "','" + resultPath + "')");
}

function placeImageAsRaster(path) {
    app.activeDocument.suspendHistory("Place and Rasterize", "placeImageAsRasterImpl('" + path + "')");
}

function saveImageAndMaskImpl(imagePath, maskPath, resultPath) {
    try {
        var doc = app.activeDocument;

        var initialLayerId = doc.activeLayer.id;

        var bounds = doc.selection.bounds;
        var left = bounds[0].as("px");
        var top = bounds[1].as("px");
        var right = bounds[2].as("px");
        var bottom = bounds[3].as("px");

        var padding = 50;
        left = Math.max(0, left - padding);
        top = Math.max(0, top - padding);
        right = Math.min(doc.width.as("px"), right + padding);
        bottom = Math.min(doc.height.as("px"), bottom + padding);

        saveTxtFile(resultPath + ".txt", left + "," + top);

        var whiteColor = new SolidColor(); whiteColor.rgb.red = 255; whiteColor.rgb.green = 255; whiteColor.rgb.blue = 255;
        var blackColor = new SolidColor(); blackColor.rgb.red = 0; blackColor.rgb.green = 0; blackColor.rgb.blue = 0;

        var whiteLayer = doc.artLayers.add();
        doc.selection.fill(whiteColor);

        var blackLayer = doc.artLayers.add();
        blackLayer.move(whiteLayer, ElementPlacement.PLACEAFTER);
        doc.selection.selectAll();
        doc.selection.fill(blackColor);
        doc.selection.deselect();

        cropAndSaveFile(left, top, right, bottom, maskPath);

        whiteLayer.remove();
        blackLayer.remove();

        cropAndSaveFile(left, top, right, bottom, imagePath);

        placeLayerAbove(initialLayerId);
    }
    catch (error) {
        alert("Error: " + error)
    }
}

function placeImageAsRasterImpl(path) {
    try {
        var pngFile = new File(path + ".png");
        var txtFile = new File(path + ".txt");

        txtFile.open("r");
        var content = txtFile.read();
        txtFile.close();

        var parts = content.split(",");
        var left = parseInt(parts[0], 10);
        var top = parseInt(parts[1], 10);

        var idPlc = charIDToTypeID("Plc ");
        var descPlc = new ActionDescriptor();
        descPlc.putPath(charIDToTypeID("null"), pngFile);
        executeAction(idPlc, descPlc, DialogModes.NO);

        var idRasterize = stringIDToTypeID("placedLayerConvertToLayers");
        executeAction(idRasterize, undefined, DialogModes.NO);

        var layer = app.activeDocument.activeLayer;
        var b = layer.bounds;
        var dx = left - b[0].as("px");
        var dy = top - b[1].as("px");
        layer.translate(dx, dy);
    }
    catch (error) {
        alert("Error: " + error)
    }
}

function placeLayerAbove(layerId)
{
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layerId);

    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);

    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}

function cropAndSaveFile(left, top, right, bottom, path) {
    var doc = app.activeDocument.duplicate();
    doc.crop([left, top, right, bottom]);
    savePngFile(path);
    doc.close(SaveOptions.DONOTSAVECHANGES);
}

function savePngFile(path) {
    var file = new File(path);
    var options = new PNGSaveOptions();
    options.compression = 0;
    options.interlaced = false;
    activeDocument.saveAs(file, options, true, Extension.LOWERCASE);
}

function saveTxtFile(path, text) {
    var file = new File(path);
    file.encoding = "UTF8";
    file.open("w");
    file.write(text);
    file.close();
}

function deleteFile(path) {
    var file = new File(path);
    if (file.exists) { file.remove(); }
}

function startServer(model, device, port) {
    try {
        var cmd = 'start "" /B cmd /C "iopaint start --model=' + model + ' --device=' + device + ' --port=' + port + '"';
        app.system(cmd);
    } catch (e) {
        alert("Error starting server: " + e);
    }
}