import { RENDER_TARGET } from './drawing-redraw-webgl';
import * as util from './webgl-util';
import { mat3 } from 'gl-matrix';

// The canvas renderer uses a mask to remove the part of the edge line that's under
// a translucent edge arrow (see the part of CRp.drawArrowhead that uses globalCompositeOperation). 
// So even if an edge arrow is translucent you don't see anything under it except the canvas background.
// To simulate this effect with WebGL we will blend edge arrow colors with the background
// color value that's passed in. That means if there is a texture or image 
// under the canvas it won't be blended propery with edge arrows, this is an 
// acceptable limitation for now.

// Vertex types
const LINE = 0;
const SOURCE_ARROW = 1;
const TARGET_ARROW = 2;


export class EdgeDrawing {

  /** 
   * @param {WebGLRenderingContext} gl 
   */
  constructor(r, gl, opts) {
    this.r = r;
    this.gl = gl;

    this.maxInstances = opts.webglBatchSize;
    this.bgColor = opts.bgColor;

    this.program = this.createShaderProgram(RENDER_TARGET.SCREEN);
    this.pickingProgram = this.createShaderProgram(RENDER_TARGET.PICKING);

    this.vao = this.createVAO();
  }

  createShaderProgram(renderTarget) {
    // see https://wwwtyro.net/2019/11/18/instanced-lines.html
    const { gl } = this;

    const vertexShaderSource = `#version 300 es
      precision highp float;

      uniform mat3 uPanZoomMatrix;

      // instanced
      in vec2 aPosition;
      in int aVertType;

      in vec4 aIndex;

      // lines
      in vec4 aSourceTarget;
      in float aLineWidth;
      in vec4 aLineColor;

      // arrows
      in ivec2 aDrawArrows; // 's' for source, 't' for target
      in vec4 aSourceArrowColor;
      in vec4 aTargetArrowColor;
      in mat3 aSourceArrowTransform;
      in mat3 aTargetArrowTransform;

      out vec4 vColor;
      flat out vec4 vIndex;
      flat out int vVertType;

      void main(void) {
        if(aVertType == ${LINE}) {
          vec2 source = aSourceTarget.xy;
          vec2 target = aSourceTarget.zw;
          vec2 xBasis = target - source;
          vec2 yBasis = normalize(vec2(-xBasis.y, xBasis.x));
          vec2 point = source + xBasis * aPosition.x + yBasis * aLineWidth * aPosition.y;
          gl_Position = vec4(uPanZoomMatrix * vec3(point, 1.0), 1.0);
          vColor = aLineColor;
        } 
        else if(aVertType == ${SOURCE_ARROW} && aDrawArrows.s == 1) {
          gl_Position = vec4(uPanZoomMatrix * aSourceArrowTransform * vec3(aPosition, 1.0), 1.0);
          vColor = aSourceArrowColor;
        }
        else if(aVertType == ${TARGET_ARROW} && aDrawArrows.t == 1) {
          gl_Position = vec4(uPanZoomMatrix * aTargetArrowTransform * vec3(aPosition, 1.0), 1.0);
          vColor = aTargetArrowColor;
        } 
        else {
          gl_Position = vec4(2.0, 0.0, 0.0, 1.0); // discard vertex by putting it outside webgl clip space
          vColor = vec4(0.0, 0.0, 0.0, 0.0);
        }

        vIndex = aIndex;
        vVertType = aVertType;
      }
    `;

    const fragmentShaderSource = `#version 300 es
      precision highp float;

      uniform vec4 uBGColor;

      in vec4 vColor;
      flat in vec4 vIndex;
      flat in int vVertType;

      out vec4 outColor;

      void main(void) {
        if(vVertType == ${SOURCE_ARROW} || vVertType == ${TARGET_ARROW}) {
          // blend arrow color with background (using premultiplied alpha)
          outColor.rgb = vColor.rgb + (uBGColor.rgb * (1.0 - vColor.a)); 
          outColor.a = 1.0; // make opaque, masks out line under arrow
        } else {
          outColor = vColor;
        }

        ${ renderTarget.picking ?
          ` if(outColor.a == 0.0)
              outColor = vec4(0.0, 0.0, 0.0, 0.0);
            else
              outColor = vIndex;
          `
          : ''
        }
      }
    `;

    const program = util.createProgram(gl, vertexShaderSource, fragmentShaderSource);

    program.uPanZoomMatrix = gl.getUniformLocation(program, 'uPanZoomMatrix');
    program.uBGColor = gl.getUniformLocation(program, 'uBGColor');
    
    program.aPosition  = gl.getAttribLocation(program, 'aPosition');
    program.aVertType  = gl.getAttribLocation(program, 'aVertType');

    program.aIndex        = gl.getAttribLocation(program, 'aIndex');
    program.aSourceTarget = gl.getAttribLocation(program, 'aSourceTarget');
    program.aLineWidth    = gl.getAttribLocation(program, 'aLineWidth');
    program.aLineColor    = gl.getAttribLocation(program, 'aLineColor');

    program.aDrawArrows           = gl.getAttribLocation(program, 'aDrawArrows');
    program.aSourceArrowColor     = gl.getAttribLocation(program, 'aSourceArrowColor');
    program.aTargetArrowColor     = gl.getAttribLocation(program, 'aTargetArrowColor');
    program.aSourceArrowTransform = gl.getAttribLocation(program, 'aSourceArrowTransform');
    program.aTargetArrowTransform = gl.getAttribLocation(program, 'aTargetArrowTransform');

    return program;
  }

  createVAO() {
    const line = [
      0, -0.5,   1, -0.5,   1, 0.5,
      0, -0.5,   1,  0.5,   0, 0.5
    ];
    const arrow = [ // same as the 'triangle' shape in the base renderer
      -0.15, -0.3,   0, 0,    0.15, -0.3
    ];
    const label = [ // same as NodeDrawing
      0, 0,  0, 1,  1, 0,
      1, 0,  0, 1,  1, 1,
    ];

    const instanceGeometry = [ // order matters, back to front
      ...line,  // edge line
      ...arrow, // source arrow
      ...arrow, // target arrow
    ];

    const typeOf = verts => ({ is: type => new Array(verts.length/2).fill(type) });
    const vertTypes = [
      ...typeOf(line).is(LINE),
      ...typeOf(arrow).is(SOURCE_ARROW),
      ...typeOf(arrow).is(TARGET_ARROW),
    ];

    this.vertexCount = instanceGeometry.length / 2;
  
    const { gl, program } = this;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    util.createBufferStaticDraw(gl, 'vec2', program.aPosition, instanceGeometry);
    util.createBufferStaticDraw(gl, 'int',  program.aVertType, vertTypes);

    const n = this.maxInstances;
    this.indexBuffer = util.createBufferDynamicDraw(gl, n, 'vec4', program.aIndex);
    this.sourceTargetBuffer = util.createBufferDynamicDraw(gl, n, 'vec4', program.aSourceTarget);
    this.lineWidthBuffer = util.createBufferDynamicDraw(gl, n, 'float', program.aLineWidth);
    this.lineColorBuffer = util.createBufferDynamicDraw(gl, n, 'vec4' , program.aLineColor);

    this.drawArrowsBuffer = util.createBufferDynamicDraw(gl, n, 'ivec2', program.aDrawArrows);
    this.sourceArrowColorBuffer = util.createBufferDynamicDraw(gl, n, 'vec4', program.aSourceArrowColor);
    this.targetArrowColorBuffer = util.createBufferDynamicDraw(gl, n, 'vec4', program.aTargetArrowColor);
    this.sourceArrowTransformBuffer = util.create3x3MatrixBufferDynamicDraw(gl, n, program.aSourceArrowTransform);
    this.targetArrowTransformBuffer = util.create3x3MatrixBufferDynamicDraw(gl, n, program.aTargetArrowTransform);

    gl.bindVertexArray(null);
    return vao;
  }


  getArrowInfo(edge, prefix, edgeOpacity, edgeWidth) {
    const rs = edge._private.rscratch;
    if(rs.edgeType !== 'straight') { // only straight edges get arrows for now
      return;
    }

    let x, y, angle;
    if(prefix === 'source') {
      x = rs.arrowStartX;
      y = rs.arrowStartY;
      angle = rs.srcArrowAngle;
    } else {
      x = rs.arrowEndX;
      y = rs.arrowEndY;
      angle = rs.tgtArrowAngle;
    }

    // taken from CRp.drawArrowhead
    if(isNaN(x) || x == null || isNaN(y) || y == null || isNaN(angle) || angle == null) { 
      return; 
    }

    let color = edge.pstyle(prefix + '-arrow-color').value;
    let scale = edge.pstyle('arrow-scale').value;
    let size = this.r.getArrowWidth(edgeWidth, scale);

    let webglColor = util.toWebGLColor(color, edgeOpacity);

    const transform = mat3.create();
    mat3.translate(transform, transform, [x, y]);
    mat3.scale(transform, transform, [size, size]);
    mat3.rotate(transform, transform, angle);

    return {
      transform,
      webglColor
    }
  }

  startFrame(panZoomMatrix, debugInfo, renderTarget = RENDER_TARGET.SCREEN) {
    this.panZoomMatrix = panZoomMatrix
    this.debugInfo = debugInfo;
    this.renderTarget = renderTarget;
  }

  startBatch() {
    this.instanceCount = 0;
  }

  draw(edge, eleIndex) {
    // edge points and arrow angles etc are calculated by the base renderer and cached in the rscratch object
    const rs = edge._private.rscratch;
    const i = this.instanceCount;

    // line style
    const baseOpacity = edge.pstyle('opacity').value;
    const lineOpacity = edge.pstyle('line-opacity').value;
    const width = edge.pstyle('width').pfValue;
    const color = edge.pstyle('line-color').value;
    const opacity = baseOpacity * lineOpacity;

    // source and target points
    const allpts = rs.allpts;
    const sx = allpts[0];
    const sy = allpts[1];
    const tx = allpts[allpts.length-2];
    const ty = allpts[allpts.length-1];

    // arrows
    // TODO imporove performance buy removing calls to setData like below
    let drawSource = false;
    let drawTarget = false;
    const sourceInfo = this.getArrowInfo(edge, 'source', opacity, width);
    if(sourceInfo) {
      this.sourceArrowColorBuffer.setData(sourceInfo.webglColor, i);
      this.sourceArrowTransformBuffer.setData(sourceInfo.transform, i);
      drawSource = true;
    }
    const targetInfo = this.getArrowInfo(edge, 'target', opacity, width);
    if(targetInfo) {
      this.targetArrowColorBuffer.setData(targetInfo.webglColor, i);
      this.targetArrowTransformBuffer.setData(targetInfo.transform, i);
      drawTarget = true;
    }

    // Buffer data. We use direct array access through a view for performance.
    {
      const view = this.indexBuffer.getView(i);
      view[0] = ((eleIndex >>  0) & 0xFF) / 0xFF;
      view[1] = ((eleIndex >>  8) & 0xFF) / 0xFF;
      view[2] = ((eleIndex >> 16) & 0xFF) / 0xFF;
      view[3] = ((eleIndex >> 24) & 0xFF) / 0xFF;
    }
    {
      const view = this.sourceTargetBuffer.getView(i);
      view[0] = sx;
      view[1] = sy;
      view[2] = tx;
      view[3] = ty;
    }
    {
      const view = this.lineWidthBuffer.getView(i);
      view[0] = width;
    }
    {
      const view = this.lineColorBuffer.getView(i);
      const a = opacity;
      view[0] = (color[0] / 255) * a;
      view[1] = (color[1] / 255) * a;
      view[2] = (color[2] / 255) * a;
      view[3] = a;
    }
    {
      const view = this.drawArrowsBuffer.getView(i);
      view[0] = drawSource ? 1 : 0;
      view[1] = drawTarget ? 1 : 0;
    }

    this.instanceCount++;

    if(this.instanceCount >= this.maxInstances) {
      this.endBatch();
    }
  }

  endBatch() {
    const { gl, vao, vertexCount, instanceCount: count } = this;
    if(count === 0) 
      return;

    const program = this.renderTarget.picking 
      ? this.pickingProgram 
      : this.program;

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    // buffer the attribute data
    this.indexBuffer.bufferSubData(count);
    this.sourceTargetBuffer.bufferSubData(count);
    this.lineWidthBuffer.bufferSubData(count);
    this.lineColorBuffer.bufferSubData(count);
    this.drawArrowsBuffer.bufferSubData(count);
    this.sourceArrowColorBuffer.bufferSubData(count);
    this.targetArrowColorBuffer.bufferSubData(count);
    this.sourceArrowTransformBuffer.bufferSubData(count);
    this.targetArrowTransformBuffer.bufferSubData(count);

    // Set the projection matrix uniform
    gl.uniformMatrix3fv(program.uPanZoomMatrix, false, this.panZoomMatrix);

    // set background color (this is a hack)
    const webglBgColor = util.toWebGLColor(this.bgColor, 1);
    gl.uniform4fv(program.uBGColor, webglBgColor);

    // draw!
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertexCount, count);

    gl.bindVertexArray(null);

    if(this.debugInfo) {
      this.debugInfo.push({ count });
    }
    
    // start another batch, even if not needed
    this.startBatch();
  }

}
