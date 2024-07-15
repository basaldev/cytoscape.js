/* eslint-disable no-console, no-unused-vars */
/* global $, cytoscape, options, cy, networks, styles */

var cy;

var params = {};

(function(){

  const urlParams = new URLSearchParams(window.location.search);
  params.networkID = urlParams.get('networkID') || 'em-web';
  params.webgl = urlParams.get('webgl') === 'true';
  params.bgcolor = urlParams.get('bgcolor') || 'white';

  const network = networks[params.networkID];
  const style = styles[params.networkID];
  $('#cytoscape').style.backgroundColor = params.bgcolor;

  function load(elements, style) {
    options = {
      container: $('#cytoscape'),
  
      renderer: {
        name: 'canvas',
        showFps: true,
        webgl: params.webgl,
      },

      style: style,
      elements: elements,
      layout: network.layout
    };
    options.layout.animate = false;
    cy = cytoscape(options);
  }

  if(style.file) {
    console.log('loading style from file: ', style.file);
    Promise.all([
      fetch(network.url).then(res => res.json()),
      fetch(style.file).then(res => res.json())
    ]).then(([networkJson, styleJson]) => {
      load(networkJson.elements, styleJson.style);
    });
  } else {
    fetch(network.url)
    .then(res => res.json())
    .then(networkJson => {
      const style = styles[params.networkID];
      load(networkJson.elements, style);
    });
  }

})();
