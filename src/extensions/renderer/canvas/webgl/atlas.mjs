import * as util from './webgl-util.mjs';
import * as cyutil from '../../../../util/index.mjs';
import { mat3 } from 'gl-matrix';

// A "texture atlas" is a big image/canvas, and sections of it are used as textures for nodes/labels.

/**
 * A single square texture atlas (also known as a "sprite sheet").
 */
export class Atlas {

  constructor(r, texSize, texRows, createTextureCanvas) {
    this.debugID = Math.floor(Math.random() * 10000);
    this.r = r;

    this.texSize = texSize;
    this.texRows = texRows;
    this.texHeight = Math.floor(texSize / texRows);

    this.enableWrapping = true; // hardcoded for now, can be made an option

    this.locked = false; // once an atlas is locked it can no longer be drawn to
    this.texture = null; // WebGLTexture object
    this.needsBuffer = true;
    
    // a "location" is an object with a 'row' and 'x' fields
    this.freePointer = { x: 0, row: 0 };

    // map from the style key to the row/x where the texture starts
    // if the texture wraps then there's a second location
    this.keyToLocation = new Map(); // styleKey -> [ location, location ]

    this.canvas  = createTextureCanvas(r, texSize, texSize);
    this.scratch = createTextureCanvas(r, texSize, this.texHeight, 'scratch');
  }

  lock() {
    this.locked = true;
  }

  getKeys() {
    return new Set(this.keyToLocation.keys());
  }

  getScale({ w, h }) {
    const { texHeight, texSize: maxTexWidth } = this;
    // try to fit to the height of a row
    let scale = texHeight / h;  // TODO what about pixelRatio?
    let texW = w * scale;
    let texH = h * scale;
    // if the scaled width is too wide then scale to fit max width instead
    if(texW > maxTexWidth) {
      scale = maxTexWidth / w;
      texW = w * scale;
      texH = h * scale;
    }
    return { scale, texW, texH };
  }


  draw(key, bb, doDrawing) {
    if(this.locked)
      throw new Error('can\'t draw, atlas is locked');

    const { texSize, texRows, texHeight } = this;
    const { scale, texW, texH } = this.getScale(bb);
    
    const locations = [ null, null ];

    const drawAt = (location, canvas) => {
      if(doDrawing && canvas) {
        const { context } = canvas;
        const { x, row } = location;
        const xOffset = x;
        const yOffset = texHeight * row;

        context.save();
        context.translate(xOffset, yOffset);
        context.scale(scale, scale);
        doDrawing(context, bb);
        context.restore();
      }
    };

    const drawNormal = () => {
      // don't need to wrap, draw directly on the canvas
      drawAt(this.freePointer, this.canvas);
            
      locations[0] = {
        x: this.freePointer.x,
        y: this.freePointer.row * texHeight,
        w: texW,
        h: texH
      };
      locations[1] = {  // indlude a second location with a width of 0, for convenience
        x: this.freePointer.x + texW,
        y: this.freePointer.row * texHeight,
        w: 0,
        h: texH
      }; 

      // move the pointer to the end of the texture
      this.freePointer.x += texW;
      if(this.freePointer.x == texSize) {
        // move to the next row
        // TODO what if there is no next row???
        this.freePointer.x = 0;
        this.freePointer.row++;
      }
    };

    const drawWrapped = () => {
      const { scratch, canvas } = this;

      // Draw to the scratch canvas
      scratch.clear();
      drawAt({ x:0, row:0 }, scratch);

      const firstTexW = texSize - this.freePointer.x;
      const secondTexW = texW - firstTexW;
      const h = texHeight;

      { // copy first part of scratch to the first texture
        const dx = this.freePointer.x;
        const dy = this.freePointer.row * texHeight;
        const w = firstTexW;
        
        canvas.context.drawImage(scratch, 
          0,  0,  w, h, 
          dx, dy, w, h
        );
        
        locations[0] = { 
          x: dx, 
          y: dy, 
          w: w, 
          h: texH 
        };
      }
      { // copy second part of scratch to the second texture
        const sx = firstTexW;
        const dy = (this.freePointer.row + 1) * texHeight;
        const w = secondTexW;

        if(canvas) {
          canvas.context.drawImage(scratch, 
            sx, 0, w, h, 
            0, dy, w, h
          );
        }

        locations[1] = { 
          x: 0, 
          y: dy,
          w: w,  
          h: texH 
        };
      }

      this.freePointer.x = secondTexW;
      this.freePointer.row++;
    };

    const moveToStartOfNextRow = () => {
      this.freePointer.x = 0;
      this.freePointer.row++;
    };

    if(this.freePointer.x + texW <= texSize) { // There's enough space in the current row
      drawNormal();
    } else if(this.freePointer.row >= texRows-1) { // Need to move to the next row, but there are no more rows, atlas is full.
      return false;
    } else if(this.freePointer.x === texSize) { // happen to be right at end of current row
      moveToStartOfNextRow();
      drawNormal();
    } else if(this.enableWrapping) { // draw part of the texture to the end of the curent row, then wrap to the next row
      drawWrapped();
    } else { // move to the start of the next row, then draw normally
      moveToStartOfNextRow();
      drawNormal();
    }

    this.keyToLocation.set(key, locations);
    this.needsBuffer = true;
    return locations;
  }

  getOffsets(key) {
    return this.keyToLocation.get(key);
  }

  isEmpty() {
    return this.freePointer.x === 0 && this.freePointer.row === 0;
  }

  canFit(bb) {
    if(this.locked)
      return false;

    const { texSize, texRows } = this;
    const { texW } = this.getScale(bb);
    if(this.freePointer.x + texW > texSize) { // need to wrap
      return this.freePointer.row < texRows - 1; // return true if there's a row to wrap to
    }
    return true;
  }

  // called on every frame
  bufferIfNeeded(gl) {
    if(!this.texture) {
      this.texture = util.createTexture(gl, this.debugID);
    }
    if(this.needsBuffer) {
      this.texture.buffer(this.canvas);
      this.needsBuffer = false;

      if(this.locked) {
        this.canvas = null;
        this.scratch = null;
      }
    }
  }

  dispose() {
    if(this.texture) {
      this.texture.deleteTexture();
      this.texture = null;
    }
    this.canvas = null;
    this.scratch = null;
    this.locked = true;
  }

}

/**
 * A collection of texture atlases, all of the same "render type". 
 * (Node body is an example of a render type.)
 * An AtlasCollection can also be notified when a texture is no longer needed, 
 * and it can garbage collect the unused textures.
 */
export class AtlasCollection {

  constructor(r, texSize, texRows, createTextureCanvas) {
    this.r = r;

    this.texSize = texSize;
    this.texRows = texRows;
    this.createTextureCanvas = createTextureCanvas;

    this.atlases = [];
    this.styleKeyToAtlas = new Map();
    this.markedKeys = new Set(); // marked for garbage collection
  }

  getKeys() {
    return new Set(this.styleKeyToAtlas.keys());
  }

  _createAtlas() {
    const { r, texSize, texRows, createTextureCanvas } = this;
    return new Atlas(r, texSize, texRows, createTextureCanvas);
  }

  _getScratchCanvas() {
    if(!this.scratch) {
      const { r, texSize, texRows, createTextureCanvas } = this;
      const texHeight = Math.floor(texSize / texRows);
      this.scratch = createTextureCanvas(r, texSize, texHeight, 'scratch');
    }
    return this.scratch;
  }

  draw(key, bb, doDrawing) {
    let atlas = this.styleKeyToAtlas.get(key);
    if(!atlas) {
      // check for space at the end of the last atlas
      atlas = this.atlases[this.atlases.length - 1];
      if(!atlas || !atlas.canFit(bb)) {
        if(atlas)
          atlas.lock();
        // create a new atlas
        atlas = this._createAtlas();
        this.atlases.push(atlas);
      }

      atlas.draw(key, bb, doDrawing);

      this.styleKeyToAtlas.set(key, atlas);
    }
    return atlas;
  }

  getAtlas(key) {
    return this.styleKeyToAtlas.get(key);
  }

  hasAtlas(key) {
    return this.styleKeyToAtlas.has(key);
  }

  markKeyForGC(key) {
    this.markedKeys.add(key);
  }

  gc() {
    const { markedKeys } = this;
    if(markedKeys.size === 0) {
      console.log('nothing to garbage collect');
      return;
    }

    const newAtlases = [];
    const newStyleKeyToAtlas = new Map();

    let newAtlas = null;

    for(const atlas of this.atlases) {
      const keys = atlas.getKeys();
      const keysToCollect = intersection(markedKeys, keys);

      if(keysToCollect.size === 0) {
        // this atlas can still be used
        newAtlases.push(atlas);
        keys.forEach(k => newStyleKeyToAtlas.set(k, atlas));
        continue;
      } 

      if(!newAtlas) {
        newAtlas = this._createAtlas();
        newAtlases.push(newAtlas);
      }

      for(const key of keys) {
        if(!keysToCollect.has(key)) {
          const [ s1, s2 ] = atlas.getOffsets(key);
          if(!newAtlas.canFit({ w: s1.w + s2.w, h: s1.h })) {
            newAtlas.lock();
            
            newAtlas = this._createAtlas();
            newAtlases.push(newAtlas);
          }
          this._copyTextureToNewAtlas(key, atlas, newAtlas);
          newStyleKeyToAtlas.set(key, newAtlas);
        }
      }

      atlas.dispose();
    }

    this.atlases = newAtlases;
    this.styleKeyToAtlas = newStyleKeyToAtlas;
    this.markedKeys = new Set();
  }


  _copyTextureToNewAtlas(key, oldAtlas, newAtlas) {
    const [ s1, s2 ] = oldAtlas.getOffsets(key);

    if(s2.w === 0) { // the texture does not wrap, draw directly to new atlas
      newAtlas.draw(key, s1, context => {
        context.drawImage(oldAtlas.canvas, 
          s1.x, s1.y, s1.w, s1.h, 
          0,    0,    s1.w, s1.h
        );
      });
    } else {
      // the texture wraps, first draw both parts to a scratch canvas
      const scratch = this._getScratchCanvas();
      scratch.clear();
      scratch.context.drawImage(oldAtlas.canvas, 
        s1.x, s1.y, s1.w, s1.h,
        0,    0,    s1.w, s1.h
      );
      scratch.context.drawImage(oldAtlas.canvas, 
        s2.x, s2.y, s2.w, s2.h,
        s1.w, 0,    s2.w, s2.h
      );

      // now draw the scratch to the new atlas
      const w = s1.w + s2.w;
      const h = s1.h;
      newAtlas.draw(key, { w, h }, context => {
        context.drawImage(scratch, 
          0, 0, w, h,
          0, 0, w, h   // the destination context has already been translated to the correct position
        );
      });
    }
  }

  getCounts() {
    return { 
      keyCount: this.styleKeyToAtlas.size,
      atlasCount: new Set(this.styleKeyToAtlas.values()).size
    };
  }

}


function intersection(set1, set2) {
  // TODO why no Set.intersection in node 16???
  if(set1.intersection)
    return set1.intersection(set2);
  else
    return new Set([...set1].filter(x => set2.has(x)));
}


/**
 * Used to manage batches of Atlases for drawing nodes and labels.
 * Supports different types of AtlasCollections for different render types (or 'texture groups'),
 * for example 'node body' and 'node label' would be different render types.
 * Render types are kept separate because they will likely need to be garbage collected
 * separately and its not entierly guaranteed that their style keys won't collide.
 */
export class AtlasManager {

  constructor(r, globalOptions) {
    this.r = r;

    this.globalOptions = globalOptions;
    this.atlasSize = globalOptions.webglTexSize;
    this.maxAtlasesPerBatch = globalOptions.webglTexPerBatch;

    this.renderTypes = new Map(); // renderType:string -> renderTypeOptions
    this.collections = new Map(); // collectionName:string -> AtlasCollection

    this.typeAndIdToKey = new Map(); // [renderType,id] => style key

    this.batchAtlases = [];
  }

  getAtlasSize() {
    return this.atlasSize;
  }

  getMaxAtlasesPerBatch() {
    return this.maxAtlasesPerBatch;
  }

  addAtlasCollection(collectionName, atlasCollectionOptions) {
    const { webglTexSize, createTextureCanvas } = this.globalOptions;
    const { texRows } = atlasCollectionOptions;
    const cachedCreateTextureCanvas = this._cacheScratchCanvas(createTextureCanvas);
    const atlasCollection = new AtlasCollection(this.r, webglTexSize, texRows, cachedCreateTextureCanvas);
    this.collections.set(collectionName, atlasCollection);
  }

  addRenderType(type, renderTypeOptions) {
    const { collection } = renderTypeOptions;
    if(!this.collections.has(collection))
      throw new Error(`invalid atlas collection name '${collection}'`);
    const atlasCollection = this.collections.get(collection);
    const opts = cyutil.extend({ type, atlasCollection }, renderTypeOptions);
    this.renderTypes.set(type, opts);
  }

  getRenderTypeOpts(type) {
    return this.renderTypes.get(type);
  }

  getAtlasCollection(name) {
    return this.collections.get(name);
  }

  _cacheScratchCanvas(createTextureCanvas) {
    // all scratch canvases for the same render type will have the same width and height (ie webglTexRows option)
    // but we'll keep track of the width and height just to be safe
    let prevW = -1;
    let prevH = -1;
    let scratchCanvas = null;

    return (r, w, h, scratch) => {
      if(scratch) {
        if(!scratchCanvas || w != prevW || h != prevH) {
          prevW = w;
          prevH = h;
          scratchCanvas = createTextureCanvas(r, w, h);
        }
        return scratchCanvas;
      } else {
        return createTextureCanvas(r, w, h);
      }
    };
  }

  _key(renderType, id) {
    return `${renderType}-${id}`; // TODO not very efficient
  }

  /** Marks textues associated with the element for garbage collection. */
  invalidate(eles, { forceRedraw=false, filterEle=()=>true, filterType=()=>true } = {}) {
    let needGC = false;
    let runGCNow = false;

    for(const ele of eles) {
      if(filterEle(ele)) {
        
        for(const opts of this.renderTypes.values()) {
          const renderType = opts.type;
          if(filterType(renderType)) {

            const styleKey = opts.getKey(ele);
            const atlasCollection = this.collections.get(opts.collection);

            // when a node's background image finishes loading, the style key doesn't change but still needs to be redrawn
            if(forceRedraw) { 
              atlasCollection.markKeyForGC(styleKey);
              runGCNow = true; // run GC to remove the old texture right now, that way we don't need to remember for the next gc 
            } else {
              const id = opts.getID ? opts.getID(ele) : ele.id();
              const mapKey = this._key(renderType, id);
              const oldStyleKey = this.typeAndIdToKey.get(mapKey);

              if(oldStyleKey !== undefined && oldStyleKey !== styleKey) {
                this.typeAndIdToKey.delete(mapKey);
                atlasCollection.markKeyForGC(oldStyleKey);
                needGC = true;
              }
            }
          }
        }
      }
    }

    if(runGCNow) {
      this.gc();
      needGC = false;
    }
    return needGC;
  }

  /** Garbage collect */
  gc() {
    for(const collection of this.collections.values()) {
      collection.gc();
    }
  }

  getOrCreateAtlas(ele, type, bb) {
    const opts = this.renderTypes.get(type);
    const styleKey = opts.getKey(ele);
    if(!bb)
      bb = opts.getBoundingBox(ele);

    const atlasCollection = this.collections.get(opts.collection);

    // draws the texture only if needed
    let drawn = false;
    const atlas = atlasCollection.draw(styleKey, bb, context => {
      opts.drawElement(context, ele, bb, true, true);
      drawn = true;
    });

    if(drawn) {
      const id = opts.getID ? opts.getID(ele) : ele.id(); // for testing
      const mapKey = this._key(type, id);
      this.typeAndIdToKey.set(mapKey, styleKey);
    }

    return atlas;
  }

  startBatch() {
    this.batchAtlases = [];
  }

  getAtlasCount() {
    return this.batchAtlases.length;
  }

  getAtlases() {
    return this.batchAtlases;
  }

  canAddToCurrentBatch(ele, type) {
    if(this.batchAtlases.length === this.maxAtlasesPerBatch) { 
      // batch is full, is the atlas already part of this batch?
      const opts = this.renderTypes.get(type);
      const styleKey = opts.getKey(ele);
      const atlasCollection = this.collections.get(opts.collection);
      const atlas = atlasCollection.getAtlas(styleKey);
      // return true if there is an atlas and it is part of this batch already
      return Boolean(atlas) && this.batchAtlases.includes(atlas);
    }
    return true; // not full
  }

  getAtlasIndexForBatch(atlas) {
    let atlasID = this.batchAtlases.indexOf(atlas);
    if(atlasID < 0) {
      if(this.batchAtlases.length === this.maxAtlasesPerBatch) {
        return;
      }
      this.batchAtlases.push(atlas);
      atlasID = this.batchAtlases.length - 1;
    }
    return atlasID;
  }

  getIndexArray() {
    return Array.from({ length: this.maxAtlasesPerBatch }, (v,i) => i);
  }

  getAtlasInfo(ele, type) {
    const opts = this.renderTypes.get(type);
    const bb = opts.getBoundingBox(ele);
    const atlas = this.getOrCreateAtlas(ele, type, bb);
    const index = this.getAtlasIndexForBatch(atlas);
    if(index === undefined) {
      return undefined; // batch is full
    }
    const styleKey = opts.getKey(ele);
    const [ tex1, tex2 ] = atlas.getOffsets(styleKey);
    // This object may be passed back to setTransformMatrix()
    return { index, tex1, tex2, bb };
  }
  

  /**
   * matrix is expected to be a 9 element array
   * this function follows same pattern as CRp.drawCachedElementPortion(...)
   */
  setTransformMatrix(ele, matrix, type, atlasInfo, first=true) {
    const opts = this.getRenderTypeOpts(type);
    const padding = opts.getPadding ? opts.getPadding(ele) : 0;
    

    if(atlasInfo) { // we've already computed the bb and tex bounds for a texture
      const { bb, tex1, tex2 } = atlasInfo;

      // wrapped textures need separate matrix for each part
      let ratio = tex1.w / (tex1.w + tex2.w); 
      if(!first) { // first = true means its the first part of the wrapped texture
        ratio = 1 - ratio;
      }

      const adjBB = this.getAdjustedBB(bb, padding, first, ratio);
      this._applyTransformMatrix(matrix, adjBB, opts, ele);
    } 
    else {
      // we don't have a texture yet, or we want to avoid creating a texture for simple shapes
      const bb = opts.getBoundingBox(ele);
      const adjBB = this.getAdjustedBB(bb, padding, true, 1);
      this._applyTransformMatrix(matrix, adjBB, opts, ele);
    }
  }
  
  
  _applyTransformMatrix(matrix, adjBB, opts, ele) {
    let x, y;
    mat3.identity(matrix);

    const theta = opts.getRotation ? opts.getRotation(ele) : 0;
    if(theta !== 0) {
      const { x:sx, y:sy } = opts.getRotationPoint(ele);
      mat3.translate(matrix, matrix, [sx, sy]);
      mat3.rotate(matrix, matrix, theta);

      const offset = opts.getRotationOffset(ele);

      x = offset.x + adjBB.xOffset;
      y = offset.y;
    } else {
      x = adjBB.x1;
      y = adjBB.y1;
    }

    mat3.translate(matrix, matrix, [x, y]);
    mat3.scale(matrix, matrix, [adjBB.w, adjBB.h]);
  }

  /**
   * Adjusts a node or label BB to accomodate padding and split for wrapped textures.
   * @param bb - the original bounding box
   * @param padding - the padding to add to the bounding box
   * @param first - whether this is the first part of a wrapped texture
   * @param ratio - the ratio of the texture width of part of the text to the entire texture
   */
  getAdjustedBB(bb, padding, first, ratio) {
    let { x1, y1, w, h } = bb;

    if(padding) {
      x1 -= padding;
      y1 -= padding;
      w += 2 * padding;
      h += 2 * padding;
    }

    let xOffset = 0;
    const adjW = w * ratio;

    if(first && ratio < 1) {
      w = adjW;
    } else if(!first && ratio < 1) {
      xOffset = w - adjW;
      x1 += xOffset;
      w = adjW;
    }

    return { x1, y1, w, h, xOffset };
  }

  getDebugInfo() {
    const debugInfo = [];
    for(let [ name, collection ] of this.collections) {
      const { keyCount, atlasCount } = collection.getCounts();
      debugInfo.push({ type: name, keyCount, atlasCount });
    }
    return debugInfo;
  }

}
