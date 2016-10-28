L.LayerGroup.include({

    getLayerBy: function (key, value) {
      var found = false;
      this.eachLayer(function(layer) {  
        if (layer.feature.properties[key] == value) {
          found = layer;
          return true;
        }
      });
      return found;
    }

});

M = function(settings) {

  var self = this;

  var _canvas = this.canvas = L.map(settings.container, {
    closePopupOnClick: false,
    continuousWorld: true,
    crs: settings.crs,
    maxZoom: 15,
    minZoom: 3,
    layers: settings.layers,
    zoomControl: false,
    worldLatLngs: settings.worldLatLngs
  });
  
  var _features = this.features = L.featureGroup();
  var _selected = this.selected = L.featureGroup();
  var _visible = this.visible = L.featureGroup();
  var _focused = this.focused = null;
  
  var _filters = this.filters = {};

  this.addGeoJSON = function(data) {  

    // A general function for registering feature data that comes in native GeoJSON format
    
    if (data.hasOwnProperty('type') && data.type == 'FeatureCollection') {
      
      L.geoJson(data, { 
        onEachFeature: function(feature, layer) {
          self.prepareLayer(layer);
        }
      });
    
    }

    this.update();

    return true;
  
  }

  this.addComment = function(event) {

    // A shortcut function for adding a temporary comment marker on canvas

    var latlng = event.latlng;
    var marker = L.marker(latlng, { draggable: true });

    // Extend marker with GeoJSON like properties
    marker.feature = {
      properties : {
        'template' : 'popup-add-comment',
        'temporary' : true
      }
    }

    self.prepareLayer(marker);
    self.openPopup(event, marker);

    return marker;

  }

  this.prepareLayer = function(layer) {
    
    // A function for wiring common layer events and push the layer into the main container

    var feature = layer.feature;
    var geometry = feature.geometry;
    var properties = feature.properties;

    layer.on('click', function(e) { 
      self.openPopup(e, layer);
    });
    
    if (properties.temporary) {
      
      self.canvas.addLayer(layer);
    
    } else {

      if (properties.hasOwnProperty('id')) {
        
        var existing = self.features.getLayerBy('id', properties.id);
      
      }

      if (existing) {

        // There is data which needs to be overwritten. Delete all layers that represent the outdated data.
        self.canvas.removeLayer(existing);
        self.features.removeLayer(existing);

      }
      
      self.features.addLayer(layer);

    }

    return layer;

  }

  this.openPopup = function(event, layer) {

    // A function for wiring additional behaviors to open popup event

    // Remove existing popups
    layer.unbindPopup();

    // Store information about currently selected layer before preparing the popup
    self.selected.clearLayers();
    self.selected.addLayer(layer);

    // Prepare stuff for popup
    var feature = layer.feature || event.target.feature;
    var properties = feature.properties;
    var template = properties.template || 'popup-view-comment';
    var content = document.getElementById(template).innerHTML;
    var latlng = event.latlng || self.focused;
    
    // Create popup with placeholder content
    var popup = L.popup({ closeButton: false }).setContent(content);
    
    layer.bindPopup(popup);
	
    if (layer.hasOwnProperty('_latlngs')) {
      
      // This is a complex layer with more than one latlngs, manually move popup to the clicked location 
      layer.openPopup(latlng);

    } else {

      // This is a simple layer with one latlng, let leaflet take care of the popup's location
      layer.openPopup();

    }

    // This is a layer that can be dragged, re-open the popup that is closed by the dragstart event 
    if (layer.hasOwnProperty('options') && layer.options.draggable === true) {

      layer.on('dragend', function(e) { layer.openPopup() });

    }

    // Store information about map's current focus after popup has been opened
    self.focused = popup.getLatLng();

    return popup;

  }

  this.closePopup = function() {

    // A function for wiring additional behaviors to close popup event

    self.selected.eachLayer(function(layer) {
      
      var feature = layer.feature;
      var properties = feature.properties;
      
      // Remove all temporary layers, when their popups are closed
      if (properties.temporary) {
        self.canvas.removeLayer(layer);
      }
    
    });
    
    // Clear remaining storage
    self.selected.clearLayers();
    self.canvas.closePopup();
    self.focused = null;

    return true;

  }

  this.update = function() {

    // A function for updating the data and UI after each change

    self.updateFeatures();
    self.updateLayers();

    var selected = self.selected.getLayers();

    // if a popup was open, restore it
    if (selected.length > 0) {

      self.openPopup({}, selected[0]);
    
    } 
    
  }
	
	this.updateFeatures = function() {

    // A function for updating the data
		
		var dateStart = self.getFilter('dateStart') || 0;
		var dateEnd = self.getFilter('dateEnd') || new Date();
    var labels = self.getFilter('label') || [];
		
    var features = self.features;
    var visible = self.visible.clearLayers();

    // reset all links and ratings
    features.eachLayer(function(layer) {
      layer.feature.properties.linked = [];
      layer.feature.properties.rating = {};
    });

    // Recalculate links based on current filtering
    features.eachLayer(function(layer) {

      var feature = layer.feature;
      var properties = feature.properties;
      
      var created_at = new Date(properties.created_at);
      var label = properties.label || false;
      var permanent = properties.permanent || false;
      var linked_id = properties.linked_id || false;

      // This feature is meant to be visible all the time, bypass other tests and break loop
      if (permanent) {
        visible.addLayer(layer);
        return true;
      }

      // This feature is out of date range, break loop
      if (dateStart > created_at || created_at > dateEnd) {
        return true;
      }

      // This feature didn't pass label filtering, break loop
      if (label && labels.indexOf(label.id) == -1) {
        return true;
      }

      // This feature provides additional information to other layers and is not meant to be visible on its own,
      // forward information to linked layers and break loop
      if (linked_id) {
        linked_id.forEach(function(id) {
          var link = features.getLayerBy('id', id);
          if (link) link.feature.properties.linked.push(layer);
        });
        return true;
      }
      
      // All tests were passed, include the layer in the group of visible objects
      visible.addLayer(layer);
   
    });

	}

	this.updateLayers = function() {

    // A function for updating what's visible on the map

    var features = self.features;
    var visible = self.visible;

    features.eachLayer(function(layer) {
      
      // This feature is not supposed to be visible at the moment, remove from canvas
      if (!visible.hasLayer(layer)) {
        self.canvas.removeLayer(layer);
        return true;
      }

      var feature = layer.feature;
      var properties = feature.properties;

      var linked = properties.linked || [];
  
      // If feature has connections to other features, determine its style based on the linked features
      if (linked.length > 0) {
        
        var colors = {};
        var rating = {};
        
        // Count the number of linked features and their labels, and store the label colors
        linked.forEach(function(link) {
          var label = link.feature.properties.label;
          var label_id = (typeof label === 'string') ? label : label.id; 
          var label_color = label.color || '#29B';
          if (!rating.hasOwnProperty(label_id)) {
            rating[label_id] = 1;
          } else {
            rating[label_id] ++;
          }
          colors[label_id] = label_color;
        })

        // Find the label that exists the most in the linked features, set that label's color as the main feature's style
        properties.style.color = colors[Object.keys(rating).sort(function(a,b) { return rating[b] - rating[a]; })[0]];

        // Store statistics of the linked features for further reference
        properties.rating = rating;
      
      } else if (properties.style) {
        properties.style.color = '#29B';
      }

      if (properties.style) {
        layer.setStyle(properties.style);
      }

      self.canvas.addLayer(layer);
      
    });

	}
	
	this.updatePopups = function(event) {

    // A function for updating popup contents 
    // kerrokantasi/talvipyöräily specific implementation defined lower

  }
	
  this.setFilter = function(key, value) {
    if (value) {
      self.filters[key] = value;
    } else {
      delete self.filters[key];
    }
  }
  
  this.getFilter = function(key) {
    return (self.filters.hasOwnProperty(key)) ? self.filters[key] : '';
  }

  this.setCenter = function (latlng, zoom) {
    var zoom = zoom || 10;
    self.canvas.setView(latlng, zoom);
  }

  this.zoomIn = function() {
    self.canvas.setZoom(self.canvas.getZoom() + 1);
  }

  this.zoomOut = function() {
    self.canvas.setZoom(self.canvas.getZoom() - 1);
  }

  this.zoomFit = function() {
    // TO DO: rewrite completely
    self.setCenter(settings.center);
  }

	this.canvas.on('click', function(event) {
		if (self.selected.getLayers().length > 0) {
      // self.closePopup(); // Leaflet 1 has a bug that causes the canvas to be clicked when a path is clicked
    } else {
      self.addComment(event);
    }
	});

  this.canvas.on('popupopen', function(event) {
    self.updatePopups(event);
  });

  if (settings.center) {
    self.setCenter(settings.center)
  }
  
  return this;

}


/// KERROKANTASI TALVIPYÖRÄILY SPECIFIC STUFF

function parseComments(data) {
  
  // Convert comment data coming from kerrokantasi-api into proper geojson objects

  var featurecollection = {
    'type' : 'FeatureCollection',
    'features' : []
  }
  
  $.each(data, function(i, d) {
    
    // If geojson field refers to an existing object (field value is an id),
    // create an empty geojson point and link it to the object
    if (typeof d.geojson === 'object' && d.geojson !== null) {
      var feature = d.geojson;
    } else {
      var feature = {
        geometry: {
          coordinates: [0, 0],
          type: 'Point'
        },
        properties: { linked_id : [ d.geojson ] },
        type: 'Feature'
      };
    }

    // Flip kerrokantasi comment fields into properties of a geojson feature
    if (!feature.hasOwnProperty('properties'))
      feature.properties = {};
    $.each(d, function(key, value) {
      if (key != 'geojson') {
        feature.properties[key] = value;
      }
    });

    // include style information (line colors) for determining how to display the routes based on their rating
    if (feature.properties.hasOwnProperty('label')) {
      var label = feature.properties.label;
      if (label.id == 60) label.color = '#0B5';
      if (label.id == 61) label.color = '#F44';
    }

    if (feature.properties.hasOwnProperty('linked_id') && typeof feature.properties.linked_id === 'string')
      feature.properties.linked_id = [feature.properties.linked_id];

    feature.properties.template = 'popup-view-comment';
    featurecollection.features.push(feature);
  
  });

  return featurecollection;

}

function parseRoutes(data) {

  // Convert routedata coming from kerrokantasi-api into proper geojson objects

  if (data.hasOwnProperty('features')) {

    data.features.forEach(function(feature) {
      if (!feature.hasOwnProperty('properties'))
        feature.properties = {};
      feature.properties.permanent = true;
      feature.properties.style = {
        color: '#29B', //'#0B5',
        lineCap: 'round',
        opacity: .75,
        weight: 10
      }
      feature.properties.template = 'popup-view-comments';
    });

  }

  return data;

}

function prepareComment(data) {

  // Convert comment object into a format understood by kerrokantasi-api

  var comment = {};

  comment.geojson = {
    "type": "Feature",
    "properties": {},
    "geometry": {
      "type": "Point",
      "coordinates": [0, 0]
    }
  }

  if (data.hasOwnProperty('latlng')) {
    comment.geojson.geometry.coordinates = [ data.latlng.lng, data.latlng.lat ];
  }

  if (data.hasOwnProperty('selected')) {
    var selected = data.selected[0];
    if (selected.hasOwnProperty('feature') && selected.feature.hasOwnProperty('properties') && selected.feature.properties.hasOwnProperty('id')) {
      comment.geojson.properties.linked_id = selected.feature.properties.id;
    }
  }

  if (data.hasOwnProperty('title')) {
    comment.title = data.title;
  }

  if (data.hasOwnProperty('content')) {
    comment.content = data.content;
  }

  if (data.hasOwnProperty('imageUrl')) {
    comment.image = { url : data.imageUrl };
    if (data.hasOwnProperty('imageCaption'))
      comment.image.caption = data.imageCaption;
  }

  if (data.hasOwnProperty('label')) {
    comment.label = parseInt(data.label);
  }

  // TEMP for generating test data
  if (comment.label)
    comment.label = { id : comment.label, label : comment.title };
  
  var now = new Date();
  comment.created_at = now.toISOString();
  comment.id = now.getTime();
  console.log(JSON.stringify(comment));

  // TEMP restore fields

  delete comment.created_at;
  delete comment.id;

  if (comment.label && comment.label.hasOwnProperty('id'))
    comment.label = comment.label.id ;

  return { comment : comment };
  
}

function prepareVote(data) {

  // Convert vote object into a format understood by kerrokantasi-api

  var vote = {};

  if (data.hasOwnProperty('selected')) {
    var selected = data.selected[0];
    if (selected.hasOwnProperty('feature') && selected.feature.hasOwnProperty('properties') && selected.feature.properties.hasOwnProperty('id')) {
      return { commentId : selected.feature.properties.id };
    }
  }

  return {};

}

function updateFiltering() {

  // Update map filtering when user changes the sidebar inputs

  var start = new Date();
  start.setDate(start.getDate() - 1);
  var end = new Date();

  if (!$('#filter-start-date').val()) {
    $('#filter-start-date').datepicker('setDate', start);
  }

  if (!$('#filter-end-date').val()) {
    $('#filter-end-date').datepicker('setDate', end);
  }

  /*
  if (!$('#filter-start-time').val()) {
    $('#filter-start-time').val(start.getHours() + ':' + start.getMinutes());
  }
  
  if (!$('#filter-end-time').val()) {
    $('#filter-emd-time').val(end.getHours() + ':' + end.getMinutes());
  }
  */
	
	var startDay = $('#filter-start-date').datepicker('getDate');
	//var startTime = $('#filter-start-time').val().split(':');
	
	var endDay = $('#filter-end-date').datepicker('getDate');
	//var endTime = $('#filter-end-time').val().split(':');
	
	var startUTC = startDay.setHours(0, 0, 0);
	var endUTC = endDay.setHours(23, 59, 59);

	var dateStart = new Date(startUTC);
	var dateEnd = new Date(endUTC);

	if (dateStart > dateEnd) {
		
		//$('#filter-end-date').datepicker('setUTCDate', dateStart);
		//$('#filter-end-time').timepicker('setTime', startDate.getHours() + ':' + startDate.getMinutes());
	
  }

  var label = $.map($('.js-filter-label:checked'), function(d) { return $(d).data('label'); });

  map.setFilter('label', label);

	map.setFilter('dateStart', dateStart);
	map.setFilter('dateEnd', dateEnd);

  map.update();

}

function messageParent(message, data) {

  if (data && message) {
    data.message = message;
    data.instanceId = instanceId;
  }

  window.parent.postMessage(data, '*');

}

function EPSG3067() {
  var bounds, crsName, crsOpts, originNw, projDef;
  crsName = 'EPSG:3067';
  projDef = '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  bounds = L.bounds(L.point(-548576, 6291456), L.point(1548576, 8388608));
  originNw = [bounds.min.x, bounds.max.y];
  crsOpts = {
    resolutions: [8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125],
    bounds: bounds,
    transformation: new L.Transformation(1, -originNw[0], -1, originNw[1])
  };
  return new L.Proj.CRS(crsName, projDef, crsOpts);
}

// INIT

var instanceId = null;

var tm35 = EPSG3067();
var worldSouthWest = tm35.projection.unproject(tm35.options.bounds.min);
var worldNorthEast = tm35.projection.unproject(tm35.options.bounds.max);
var worldLatLngs = [L.latLng(worldNorthEast.lat, worldNorthEast.lng), L.latLng(worldNorthEast.lat, worldSouthWest.lng), L.latLng(worldSouthWest.lat, worldNorthEast.lng), L.latLng(worldSouthWest.lat, worldSouthWest.lng)];
var worldOrigo = L.latLng((worldNorthEast.lat - worldSouthWest.lat) / 2, (worldNorthEast.lng - worldSouthWest.lng) / 2);

var tilelayer = L.tileLayer('http://geoserver.hel.fi/mapproxy/wmts/osm-sm/etrs_tm35fin/{z}/{x}/{y}.png');
//var tilelayer = L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/dark-v9/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoibWFwZG9uIiwiYSI6ImNpczZncHk5ajAwMjUyeXNkc3p1dTU2NjIifQ.N54dNdAT73_MD-mrdehlKQ');

var map = new M({
  center: [60.1708, 24.9375],
  container: 'map-canvas',
  crs: tm35,
  layers: [tilelayer],
  worldLatLngs: worldLatLngs
});

map.updatePopups = function(event) {

  // Function for populating popups for kerrokantasi/talvipyöräily

  var selected = map.selected.getLayers();
  var $popup = $('.leaflet-popup-content');

  // TEMP reset label counts
  $('[data-view="label-count"]').html('');

  if (selected.length > 0) {

    var properties = selected[0].feature.properties;
    var rating = properties.rating || {};
    var title = properties.name || properties.title;
    var content = properties.content || '';
    var label = properties.label;

  }

  if (event) {

    var latlng = event.popup.getLatLng() || event.latlng;

  }

  if (rating) {

    $.each(rating, function(label, count) {
      $('[data-view="label-count"][data-label="' + label + '"]').html(count);
    })

  }

  if (title) {

    $('[data-view="title"]').html(title);  

  } 

  if (label) {

    $('[data-view="label-title"]').html(label.label);  

  } 

  if (content) {

    $('[data-view="comment-content"]').html(content);  

  } 
  
  var $form = $popup.find('form');
  var $imageInput = $popup.find('[type="file"].image-input');
  var $imagePreview = $popup.find('[for="' + $imageInput.attr('id') + '"].image-preview');  
  var imageUploader = new CanvasImageUploader({ maxSize: 800, jpegQuality: 0.7 });

  $imageInput.bind('change', function onImageChanged(e) {
    var files = e.target.files || e.dataTransfer.files;
    if (files) {
      imageUploader.readImageToCanvas(files[0], $imagePreview, function () {
        imageUploader.saveCanvasToImageData($imagePreview[0]);
        $imagePreview.css('width', '100%');
      });
    }
  });

  $popup.on('click', '[data-action="new-comment"]', function(e) {
    e.preventDefault();
    var bubbled = event; bubbled.latlng = latlng;
    map.addComment(bubbled);
  });

  $popup.on('click', '[data-action="submit-comment"]', function(e) {
    e.preventDefault();
    var data = {};
    data.content = $form.find('[name="content"]').val();
    data.label = $form.find('[name="label"]').val();
    if ($imagePreview && $imagePreview.attr('width') && $imagePreview.attr('height'))
      data.image = $imagePreview[0].toDataURL();
    data.latlng = latlng;
    data.selected = selected;
    messageParent('userData', prepareComment(data));
    map.closePopup();
  });

  $popup.on('click', '[data-action="submit-rating"]', function(e) {
    e.preventDefault();
    var data = $(this).data(); 
    data.latlng = latlng;
    data.selected = selected;
    messageParent('userData', prepareComment(data));
  });

  $popup.on('click', '[data-action="submit-vote"]', function(e) {
    e.preventDefault();
    var data = {}
    data.selected = selected;
    messageParent('userVote', prepareVote(data));
  });

  $popup.on('click', '[data-dismiss="popup"]', function(e) {
    e.preventDefault();
    map.closePopup();
  });

  $popup.on('submit', 'form', function(e) {
    e.preventDefault();
  });

  $popup.on('reset', 'form', function(e) {
    e.preventDefault();
  });

}

$(function() {
  
  $('.js-datepicker').datepicker({
    autoclose: true,
    format: "dd.mm.yyyy",
    language: "fi",
    maxViewMode: 2,
    todayHighlight: true
  });
  
  $('.js-filter').on('change', function() {
    updateFiltering();
    map.update();
  });

  $('[data-action="zoom-in"]').on('click', map.zoomIn);
  $('[data-action="zoom-out"]').on('click', map.zoomOut);
  $('[data-action="zoom-fit"]').on('click', map.zoomFit);

});

window.addEventListener('message', function(message) {    
 
  if (message.data.message == 'mapData' && message.data.instanceId) {
    
    instanceId = message.data.instanceId;

    updateFiltering();

    var commentdata = JSON.parse(message.data.comments);
    var mapdata = JSON.parse(message.data.data);

    if (mapdata.hasOwnProperty('existing'))
      map.addGeoJSON(parseRoutes(mapdata.existing));

    if (commentdata.length > 0)
      map.addGeoJSON(parseComments(commentdata));

  }

});




