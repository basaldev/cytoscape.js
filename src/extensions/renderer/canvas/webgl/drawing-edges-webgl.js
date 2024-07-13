import * as util from './webgl-util';
import { defaults } from '../../../../util';
import { mat3 } from 'gl-matrix';

const initDefaults = defaults({
});

// Vertex types
const LINE = 0;
const SOURCE_ARROW = 1;
const TARGET_ARROW = 2;


export class EdgeDrawing {

  /** 
   * @param {WebGLRenderingContext} gl 
   */
  constructor(r, gl, options) {
    this.r = r;
    this.gl = gl;

    this.maxInstances = 1000; // TODO how to decide the max instances?

    this.program = this.createShaderProgram();
    this.vao = this.createVAO();
  }

  createShaderProgram() {
    // see https://wwwtyro.net/2019/11/18/instanced-lines.html
    const { gl } = this;

    const vertexShaderSource = `#version 300 es
      precision highp float;

      uniform mat3 uPanZoomMatrix;

      // instanced
      in vec2 aPosition;
      in int aVertType;

      // lines
      in vec2 aSource;
      in vec2 aTarget;
      in float aLineWidth;
      in vec4 aLineColor;

      // arrows
      in int aDrawSourceArrow;
      in int aDrawTargetArrow;
      in vec4 aSourceArrowColor;
      in vec4 aTargetArrowColor;
      in mat3 aSourceArrowTransform;
      in mat3 aTargetArrowTransform;

      out vec4 vColor;

      void main(void) {
        if(aVertType == ${LINE}) {
          vec2 xBasis = aTarget - aSource;
          vec2 yBasis = normalize(vec2(-xBasis.y, xBasis.x));
          vec2 point = aSource + xBasis * aPosition.x + yBasis * aLineWidth * aPosition.y;
          gl_Position = vec4(uPanZoomMatrix * vec3(point, 1.0), 1.0);
          vColor = aLineColor;
        } 
        else if(aVertType == ${SOURCE_ARROW} && aDrawSourceArrow == 1) {
          gl_Position = vec4(uPanZoomMatrix * aSourceArrowTransform * vec3(aPosition, 1.0), 1.0);
          // gl_Position = vec4(uPanZoomMatrix * vec3(aPosition, 1.0), 1.0);
          // gl_Position = vec4(aPosition, 1.0, 1.0);
          vColor = aSourceArrowColor;
        }
        else if(aVertType == ${TARGET_ARROW} && aDrawTargetArrow == 1) {
          gl_Position = vec4(uPanZoomMatrix * aTargetArrowTransform * vec3(aPosition, 1.0), 1.0);
          vColor = aTargetArrowColor;
        } 
        else {
          gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
          vColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      }
    `;

    const fragmentShaderSource = `#version 300 es
      precision highp float;

      in vec4 vColor;

      out vec4 outColor;

      void main(void) {
        outColor = vColor;
        outColor.rgb *= outColor.a; // webgl is expecting premultiplied alpha
      }
    `;

    const program = util.createProgram(gl, vertexShaderSource, fragmentShaderSource);

    program.uPanZoomMatrix = gl.getUniformLocation(program, 'uPanZoomMatrix');
    
    program.aPosition  = gl.getAttribLocation(program, 'aPosition');
    program.aVertType  = gl.getAttribLocation(program, 'aVertType');

    program.aSource    = gl.getAttribLocation(program, 'aSource');
    program.aTarget    = gl.getAttribLocation(program, 'aTarget');
    program.aLineWidth = gl.getAttribLocation(program, 'aLineWidth');
    program.aLineColor = gl.getAttribLocation(program, 'aLineColor');

    program.aDrawSourceArrow      = gl.getAttribLocation(program, 'aDrawSourceArrow');
    program.aDrawTargetArrow      = gl.getAttribLocation(program, 'aDrawTargetArrow');
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
      // -5, -5, 0, 0, 5, -5
    ];

    const instanceGeometry = [
      ...line,  // edge line
      ...arrow, // source arrow
      ...arrow, // target arrow
    ];
    const vertexTypes = [
      ...new Array(line .length/2).fill(LINE),
      ...new Array(arrow.length/2).fill(SOURCE_ARROW),
      ...new Array(arrow.length/2).fill(TARGET_ARROW),
    ];

    this.vertexCount = instanceGeometry.length/2;
    console.log('instance geometry', instanceGeometry);
    console.log('vertex types', vertexTypes);
    console.log('vertexCOunt', this.vertexCount);
  
    const { gl, program } = this;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    util.createAttributeBufferStaticDraw(gl, {
      attributeLoc: program.aPosition,
      dataArray: instanceGeometry,
      type: 'vec2'
    });

    util.createAttributeBufferStaticDraw(gl, {
      attributeLoc: program.aVertType,
      dataArray: vertexTypes,
      type: 'int'
    });

    this.sourceBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aSource,
      maxInstances: this.maxInstances,
      type: 'vec2'
    });

    this.targetBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aTarget,
      maxInstances: this.maxInstances,
      type: 'vec2'
    });

    this.lineWidthBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aLineWidth,
      maxInstances: this.maxInstances,
      type: 'float'
    });

    this.lineColorBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aLineColor,
      maxInstances: this.maxInstances,
      type: 'vec4'
    });

    this.drawSourceArrowBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aDrawSourceArrow,
      maxInstances: this.maxInstances,
      type: 'int'
    });

    this.drawTargetArrowBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aDrawTargetArrow,
      maxInstances: this.maxInstances,
      type: 'int'
    });

    this.sourceArrowColorBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aSourceArrowColor,
      maxInstances: this.maxInstances,
      type: 'vec4'
    });

    this.targetArrowColorBuffer = util.createInstanceBufferDynamicDraw(gl, {
      attributeLoc: program.aTargetArrowColor,
      maxInstances: this.maxInstances,
      type: 'vec4'
    });

    this.sourceArrowTransformBuffer = util.create3x3MatrixBufferDynamicDraw(gl, {
      attributeLoc: program.aSourceArrowTransform,
      maxInstances: this.maxInstances
    });

    this.targetArrowTransformBuffer = util.create3x3MatrixBufferDynamicDraw(gl, {
      attributeLoc: program.aTargetArrowTransform,
      maxInstances: this.maxInstances
    });

    gl.bindVertexArray(null);
    return vao;
  }

  startBatch(panZoomMatrix) {
    if(panZoomMatrix) {
      this.panZoomMatrix = panZoomMatrix;
    }
    this.instanceCount = 0;
  }


  // TODO Should I pass in a function that does this like with NodeDrawing?
  getLineStyle(edge) {
    const opacity = edge.pstyle('opacity').value;
    const lineOpacity = edge.pstyle('line-opacity').value;
    const width = edge.pstyle('width').pfValue;
    const color = edge.pstyle('line-color').value;
    const effectiveOpacity = opacity * lineOpacity;
    return { 
      opacity: effectiveOpacity,
      width,
      color
    };
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

    // take from CRp.drawArrowhead
    if(isNaN(x) || x == null || isNaN(y) || y == null || isNaN(angle) || angle == null) { 
      return; 
    }

    let color = edge.pstyle(prefix + '-arrow-color').value;
    let scale = edge.pstyle('arrow-scale').value;
    let size = this.r.getArrowWidth(edgeWidth, scale);

    let webglColor = util.toWebGLColor(color, edgeOpacity);
    console.log('arrow color', webglColor)

    const transform = mat3.create();
    mat3.translate(transform, transform, [x, y]);
    mat3.scale(transform, transform, [size, size]);
    mat3.rotate(transform, transform, angle);

    return {
      transform,
      webglColor
    }
  }


  draw(edge) {
    // edge points and arrow angles etc are calculated by the base renderer and cached in the rscratch object
    const rs = edge._private.rscratch;
    const i = this.instanceCount;

    // line
    const { opacity, width, color } = this.getLineStyle(edge);
    const [ sx, sy ] = rs.allpts;
    const [ tx, ty ] = rs.allpts.slice(-2);
    const lineColor = util.toWebGLColor(color, opacity); // why am I not premultiplying?
    
    this.sourceBuffer.setDataAt([sx, sy], i);
    this.targetBuffer.setDataAt([tx, ty], i);
    this.lineWidthBuffer.setDataAt([width], i);
    this.lineColorBuffer.setDataAt(lineColor, i);

    // arrows
    const sourceInfo = this.getArrowInfo(edge, 'source', opacity, width);
    if(sourceInfo) {
      this.drawSourceArrowBuffer.setDataAt([1], i);
      this.sourceArrowColorBuffer.setDataAt(sourceInfo.webglColor, i);
      const matrix = this.sourceArrowTransformBuffer.getMatrixView(i); // TODO not using matrix views properly here
      matrix.set(sourceInfo.transform, 0); 
    } else {
      this.drawSourceArrowBuffer.setDataAt([0], i);
    }

    const targetInfo = this.getArrowInfo(edge, 'target', opacity, width);
    if(targetInfo) {
      this.drawTargetArrowBuffer.setDataAt([1], i);
      this.targetArrowColorBuffer.setDataAt(targetInfo.webglColor, i);
      const matrix = this.targetArrowTransformBuffer.getMatrixView(i); // TODO not using matrix views properly here
      matrix.set(targetInfo.transform, 0); 
    } else {
      this.drawTargetArrowBuffer.setDataAt([0], i);
    }

    this.instanceCount++;

    if(this.instanceCount >= this.maxInstances) {
      this.endBatch();
    }
  }


  endBatch() {
    const { gl, program, vao, instanceCount, vertexCount } = this;
    if(instanceCount === 0) 
      return;

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    // buffer the attribute data
    this.sourceBuffer.bufferSubData(instanceCount);
    this.targetBuffer.bufferSubData(instanceCount);
    this.lineWidthBuffer.bufferSubData(instanceCount);
    this.lineColorBuffer.bufferSubData(instanceCount);

    this.drawSourceArrowBuffer.bufferSubData(instanceCount);
    this.drawTargetArrowBuffer.bufferSubData(instanceCount);
    this.sourceArrowColorBuffer.bufferSubData(instanceCount);
    this.targetArrowColorBuffer.bufferSubData(instanceCount);
    this.sourceArrowTransformBuffer.bufferSubData(instanceCount);
    this.targetArrowTransformBuffer.bufferSubData(instanceCount);

    // Set the projection matrix uniform
    gl.uniformMatrix3fv(program.uPanZoomMatrix, false, this.panZoomMatrix);

    // draw!
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertexCount, instanceCount);

    gl.bindVertexArray(null);

    // start another batch, even if not needed
    this.startBatch();
  }

}
