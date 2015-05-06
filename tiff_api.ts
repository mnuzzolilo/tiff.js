declare var loadModule: (options: Tiff.InitializeOptions) => typeof Module;

class Tiff {
  private _filename: string;
  private _tiffPtr: number;
  private static uniqueIdForFileName = 0;
  private static Module: typeof Module = null;

  public static initialize(options: Tiff.InitializeOptions): void {
    if (Tiff.Module !== null) { return; }
    Tiff.Module = loadModule(options);
  }

  constructor(params: Tiff.Params) {
    if (Tiff.Module === null) {
      Tiff.initialize({});
    }
    this._filename = Tiff.createFileSystemObjectFromBuffer(params.buffer);
    this._tiffPtr = Tiff.Module.ccall('TIFFOpen', 'number', [
      'string', 'string'], [ this._filename, 'r']);
    if (this._tiffPtr === 0) {
      throw new Tiff.Exception('The function TIFFOpen returns NULL')
    }
  }

  destroy(){
    Tiff.Module.FS.unlink( '/' + this._filename);
  }
  
  width(): number {
    return this.getField(Tiff.Tag.IMAGEWIDTH);
  }

  height(): number {
    return this.getField(Tiff.Tag.IMAGELENGTH);
  }

  tileWidth(): number {
    return this.getField(Tiff.Tag.TILEWIDTH);
  }

  tileHeight(): number {
    return this.getField(Tiff.Tag.TILELENGTH);
  }

  
  rowsPerStrip(): number {
    return this.getField(Tiff.Tag.ROWSPERSTRIP);
  }

  currentDirectory(): number {
    return Tiff.Module.ccall('TIFFCurrentDirectory', 'number',
                             ['number'], [this._tiffPtr]);
  }

  countDirectory(): number {
    var count = 0;
    var current = this.currentDirectory();
    while (true) {
      count += 1;
      var status = Tiff.Module.ccall('TIFFReadDirectory', 'number',
                                     ['number'], [this._tiffPtr]);
      if (status === 0) { break; }
    }
    this.setDirectory(current);
    return count;
  }

  setDirectory(index: number): void {
    return Tiff.Module.ccall('TIFFSetDirectory', 'number',
                             ['number', 'number'], [this._tiffPtr, index]);
  }

  getField(tag: number): number {
    var value: number = Tiff.Module.ccall('GetField', 'number', ['number', 'number'], [
      this._tiffPtr, tag]);
    return value;
  }

  readRGBAImage(): ArrayBuffer {
    var width = this.width();
    var height = this.height();
    var raster: number = Tiff.Module.ccall('_TIFFmalloc', 'number',
                                           ['number'], [width * height * 4])
    var result: number = Tiff.Module.ccall('TIFFReadRGBAImageOriented', 'number', [
      'number', 'number', 'number', 'number', 'number', 'number'], [
        this._tiffPtr, width, height, raster, 1, 0
      ]);

    if (result === 0) {
      throw new Tiff.Exception('The function TIFFReadRGBAImageOriented returns NULL');
    }
    // copy the subarray, not create new sub-view
    var data = <ArrayBuffer>(<any>Tiff.Module.HEAPU8.buffer).slice(
      raster,
      raster + width * height * 4
    );
    Tiff.Module.ccall('free', 'number', ['number'], [raster]);
    return data;
  }

  toCanvas(): HTMLCanvasElement {
    var width = this.width();
    var height = this.height();
    var raster: number = Tiff.Module.ccall('_TIFFmalloc', 'number',
                                           ['number'], [width * height * 4])
    var result: number = Tiff.Module.ccall('TIFFReadRGBAImageOriented', 'number', [
      'number', 'number', 'number', 'number', 'number', 'number'], [
        this._tiffPtr, width, height, raster, 1, 0
      ]);

    if (result === 0) {
      throw new Tiff.Exception('The function TIFFReadRGBAImageOriented returns NULL');
    }
    var image = Tiff.Module.HEAPU8.subarray(raster, raster + width * height * 4);

    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    var imageData = context.createImageData(width, height);
    (<any>imageData).data.set(image);
    context.putImageData(imageData, 0, 0);
    Tiff.Module.ccall('free', 'number', ['number'], [raster]);
    return canvas;
  }

  // I pulled this loop out to permit V8 to optimize
  // try/catch deoptimizes
  loopOverStrips (width, rowsPerStrip, numCanvases, raster, flipped, eachImageHandler){
    for (var iStrip=0; iStrip< numCanvases; iStrip++){

      var result: number = Tiff.Module.ccall('TIFFReadRGBAStrip', 'number',
                                             ['number', 'number', 'number'],
                                             [this._tiffPtr, iStrip * rowsPerStrip, raster]);
      
      if (result === 0) {
        throw new Tiff.Exception('The function TIFFReadRGBAStrip returns NULL');
      }
      
      var flippedImage = Tiff.Module.HEAPU8.subarray(flipped, flipped + width * rowsPerStrip * 4);
      // flip the image in y direction
      for (var iRow =0; iRow < rowsPerStrip; iRow++){
        var a1 = raster + (rowsPerStrip - iRow -1) * width  * 4;
        var a2 = a1 + width * 4;
        var src = Tiff.Module.HEAPU8.subarray(a1, a2);

        flippedImage.set(src, iRow * width * 4);
      }
        
      eachImageHandler(flippedImage, iStrip * rowsPerStrip, width, rowsPerStrip);
        
    }
  }
  
  toArrays(eachImageHandler) {
    var width = this.width();
    var height = this.height();
    
    var rowsPerStrip:number = this.rowsPerStrip();
    var numCanvases = Math.ceil (height/rowsPerStrip);
   
    var stripSize:number = Tiff.Module.ccall('TIFFStripSize', 'number',
                                             ['number'],
                                             [this._tiffPtr ]);

    var raster: number = Tiff.Module.ccall('_TIFFmalloc', 'number',
                                           ['number'], [width * rowsPerStrip * 4])

    var flipped: number = Tiff.Module.ccall('_TIFFmalloc', 'number',
                                           ['number'], [width * rowsPerStrip * 4])
    try {
      this.loopOverStrips ( width, rowsPerStrip, numCanvases, raster, flipped, eachImageHandler);
    } finally {
      Tiff.Module.ccall('free', 'number', ['number'], [flipped]);
      Tiff.Module.ccall('free', 'number', ['number'], [raster]);
    }

  }

  toDataURL(): string {
    return this.toCanvas().toDataURL();
  }

  close(): void {
    Tiff.Module.ccall('TIFFClose', 'number', ['number'], [this._tiffPtr]);
  }

  private static createUniqueFileName(): string {
    Tiff.uniqueIdForFileName += 1;
    return String(Tiff.uniqueIdForFileName) + '.tiff';
  }

  private static createFileSystemObjectFromBuffer(buffer: ArrayBuffer): string {
    var filename = Tiff.createUniqueFileName();
    Tiff.Module.FS.createDataFile('/', filename, new Uint8Array(buffer), true, false);
    return filename;
  }
}

module Tiff {
  export interface InitializeOptions {
    TOTAL_MEMORY?: number;
  }

  export interface Params {
    buffer: ArrayBuffer;
  }

  export class Exception {
    name: string = 'Tiff.Exception';
    constructor(public message: string) {}
  }

  export var Tag: typeof TiffTag = TiffTag;
}

// for closure compiler
Tiff.prototype['width'] = Tiff.prototype.width;
Tiff.prototype['height'] = Tiff.prototype.height;
Tiff.prototype['tileWidth'] = Tiff.prototype.tileWidth;
Tiff.prototype['tileHeight'] = Tiff.prototype.tileHeight;
Tiff.prototype['rowsPerStrip'] = Tiff.prototype.rowsPerStrip;
Tiff.prototype['currentDirectory'] = Tiff.prototype.currentDirectory;
Tiff.prototype['countDirectory'] = Tiff.prototype.countDirectory;
Tiff.prototype['setDirectory'] = Tiff.prototype.setDirectory;
Tiff.prototype['getField'] = Tiff.prototype.getField;
Tiff.prototype['readRGBAImage'] = Tiff.prototype.readRGBAImage;
Tiff.prototype['close'] = Tiff.prototype.close;
Tiff['Exception'] = Tiff.Exception;
Tiff['initialize'] = Tiff.initialize;

// export to node, amd, window or worker
declare var process: any;
declare var require: any;
declare var module: any;
declare var define: any;
declare var self: Window;

if (typeof process === 'object' && typeof require === 'function') { // NODE
  module['exports'] = Tiff;
} else if (typeof define === "function" && define.amd) { // AMD
  define('tiff', <any>[], () => Tiff);
} else if (typeof window === 'object') { // WEB
  window['Tiff'] = Tiff;
} else if (typeof importScripts === 'function') { // WORKER
  self['Tiff'] = Tiff;
}
