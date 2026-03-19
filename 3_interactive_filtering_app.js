// =====================================================
// INTERACTIVE GEE APP: Click GAUL L2 / Tile Quarter / Draw AOI
// Show seasonal small agricultural reservoirs
// DOMAIN CONSTRAINED TO 70N TO 70S
// =====================================================

// -------------------------
// 0) INPUTS
// -------------------------
var GAUL = ee.FeatureCollection("FAO/GAUL/2015/level2");

var tiles = ee.FeatureCollection("[YOUR_ASSET_PATH]/Tiles_With_Cropland_ESA");

// Precomputed quarter-tile asset
var tileQuarters = ee.FeatureCollection(
  "[YOUR_ASSET_PATH]/Tiles_filtered_crop_quarters"
);

// Seasonal collections
var IC_SEASON = {
  MAM: ee.ImageCollection("[YOUR_ASSET_PATH]/Small_reservoirs_2024/MAM"),
  JJA: ee.ImageCollection("[YOUR_ASSET_PATH]/Small_reservoirs_2024/JJA"),
  SON: ee.ImageCollection("[YOUR_ASSET_PATH]/Small_reservoirs_2024/SON"),
  DJF: ee.ImageCollection("[YOUR_ASSET_PATH]/Small_reservoirs_2024/DJF")
};

// Remaining / missing rasters
var IC_REMAINING = ee.ImageCollection("[YOUR_ASSET_PATH]/SmallRes_Rasters_2024");

// Cropland / agricultural region layer
var crop = ee.Image('[YOUR_ASSET_PATH]/croplandFiltered_Global_100m');

// -------------------------
// 0b) VALID APP DOMAIN: 70N to 70S
// -------------------------
var DOMAIN = ee.Geometry.Rectangle({
  coords: [-179.999, -70, 179.999, 70],
  geodesic: false
});

// Domain-constrained inputs
var GAUL_DOMAIN = GAUL.filterBounds(DOMAIN);
var tiles_DOMAIN = tiles.filterBounds(DOMAIN);
var tileQuarters_DOMAIN = tileQuarters.filterBounds(DOMAIN);
var crop_DOMAIN = crop.clip(DOMAIN);

// -------------------------
// 1) PARAMETERS
// -------------------------
var PARAMS = {
  year: 2024,
  minArea : 300,
  maxArea : 100000,
  scale: 10,

  vis: {
    MAM: {color: '00FF00'},
    JJA: {color: 'FFFF00'},
    SON: {color: '00AAFF'},
    DJF: {color: 'FF8800'}
  },

  gaulStyle: {color: 'FFFFFF', fillColor: '00000000', width: 1},
  selectedStyle: {color: '00FFFF', fillColor: '00000000', width: 2},
  quarterTileStyle: {color: 'FFA500', fillColor: '00000000', width: 1},
  selectedQuarterStyle: {color: 'FF00FF', fillColor: '00000000', width: 2},
  domainStyle: {color: 'FF4444', fillColor: '00000000', width: 1}
};

// Cropland edge handling params
var EDGE_PIX_CONN = 100;
var EDGE_LEN_MIN  = 20;
var EDGE_BUFFER_M = 10;

// -------------------------
// 2) UI SETUP & STYLING
// -------------------------
Map.setOptions('SATELLITE');
Map.setCenter(10, 25, 4);
Map.setLocked(false, 2, 18);

var panel = ui.Panel({style: {width: '450px', padding: '15px', backgroundColor: '#ffffff'}});

function createDivider() {
  return ui.Panel({
    style: {height: '1px', backgroundColor: '#e0e0e0', margin: '15px 0'}
  });
}

var appTitle = ui.Label('Seasonal Reservoir Explorer', {
  fontSize: '22px', fontWeight: 'bold', margin: '0 0 10px 0', textAlign: 'center', color: '#1a73e8'
});

var appDesc = ui.Label(
  'Select a tile, or a GAUL level-2 region, or draw a custom AOI to calculate and map seasonal agricultural reservoirs (March 2024 to Feb 2025). Supported domain: 70°N to 70°S.',
  {fontSize: '13px', color: '#555555'}
);

var settingsTitle = ui.Label('Settings & Controls', {
  fontWeight: 'bold', fontSize: '16px', margin: '10px 0'
});

var minAreaBox = ui.Textbox({
  placeholder: 'Min (m²)', value: String(PARAMS.minArea), style: {width: '80px'}
});

var maxAreaBox = ui.Textbox({
  placeholder: 'Max (m²)', value: String(PARAMS.maxArea), style: {width: '80px'}
});

var modeSelect = ui.Select({
  items: [
    '1. Select Tile (Tile Statistics)',
    '2. Select Region (Region Statistics)',
    '3. Draw Rectangle (Custom AOI)',
    '4. Click on Reservoir (Inspect Water)'
  ],
  value: '1. Select Tile (Tile Statistics)',
  style: {width: '260px', margin: '8px 0 0 10px', fontWeight: 'bold', color: '#1a73e8'}
});

// --- NEW OVERLAY CHECKBOXES ---

// Checkbox for Cropland Tiles Layer
var tilesCheckbox = ui.Checkbox({
  label: 'Show Cropland Tiles',
  value: true, // Default to true
  onChange: function(checked) {
    Map.layers().forEach(function(layer) {
      if (layer.getName() === 'Cropland tiles') layer.setShown(checked);
    });
  },
  style: {margin: '5px 0 0 10px', backgroundColor: '#f8f9fa'}
});

// Checkbox for GAUL Level 2 Layer
var gaulCheckbox = ui.Checkbox({
  label: 'Show GAUL Level-2 Boundaries',
  value: false, // Default to false
  onChange: function(checked) {
    Map.layers().forEach(function(layer) {
      if (layer.getName() === 'GAUL level2') layer.setShown(checked);
    });
  },
  style: {margin: '5px 0 0 10px', backgroundColor: '#f8f9fa'}
});

// Checkbox for Agricultural Region Layer
var agRegionCheckbox = ui.Checkbox({
  label: 'Show Agricultural Region',
  value: true,
  onChange: function(checked) {
    Map.layers().forEach(function(layer) {
      if (layer.getName() === 'Agricultural region') layer.setShown(checked);
    });
  },
  style: {margin: '5px 0 5px 10px', backgroundColor: '#f8f9fa'}
});

// --- INDIVIDUAL OPACITY CONTROLS ---
var opacitySliders = {};

function createSeasonOpacityControl(seasonName, colorHex) {
  var colorBox = ui.Label('', {
    backgroundColor: '#' + colorHex, padding: '8px', margin: '8px 10px 0 0', border: '1px solid #000'
  });
  
  var label = ui.Label(seasonName + ' Opacity:', {
    width: '90px', margin: '8px 0 0 0', backgroundColor: '#f8f9fa'
  });
  
  var slider = ui.Slider({
    min: 0, max: 1, value: 1, step: 0.1,
    style: {width: '150px', margin: '0 0 0 10px', backgroundColor: '#f8f9fa'}
  });
  
  opacitySliders[seasonName] = slider;
  
  slider.onChange(function(value) {
    Map.layers().forEach(function(layer) {
      if (layer.getName() === 'Res ' + seasonName) {
        layer.setOpacity(value);
      }
    });
  });
  
  return ui.Panel([colorBox, label, slider], ui.Panel.Layout.Flow('horizontal'), {backgroundColor: '#f8f9fa'});
}

var resetOpacityBtn = ui.Button({
  label: 'Reset Opacities to 100%',
  onClick: function() {
    ['MAM', 'JJA', 'SON', 'DJF'].forEach(function(s) { opacitySliders[s].setValue(1); });
    Map.layers().forEach(function(layer) {
      var name = layer.getName();
      if (name && name.indexOf('Res ') === 0) layer.setOpacity(1);
    });
  },
  style: {margin: '10px 0 0 10px'}
});

// visually grouped Settings Panel
var settingsPanel = ui.Panel({
  widgets: [
    ui.Panel([ui.Label('Mode:', {width: '110px', margin: '8px 0 0 0', fontWeight: 'bold', backgroundColor: '#f8f9fa'}), modeSelect], ui.Panel.Layout.Flow('horizontal'), {backgroundColor: '#f8f9fa'}),
    ui.Panel([ui.Label('Min Area (m²):', {width: '110px', margin: '8px 0 0 0', backgroundColor: '#f8f9fa'}), minAreaBox], ui.Panel.Layout.Flow('horizontal'), {backgroundColor: '#f8f9fa'}),
    ui.Panel([ui.Label('Max Area (m²):', {width: '110px', margin: '8px 0 0 0', backgroundColor: '#f8f9fa'}), maxAreaBox], ui.Panel.Layout.Flow('horizontal'), {backgroundColor: '#f8f9fa'}),
    
    // Grouped map overlays together
    ui.Label('Map Overlays:', {fontWeight: 'bold', margin: '15px 0 5px 0', backgroundColor: '#f8f9fa'}),
    tilesCheckbox,
    gaulCheckbox,
    agRegionCheckbox,
    
    ui.Label('Seasonal Opacity:', {fontWeight: 'bold', margin: '15px 0 5px 0', backgroundColor: '#f8f9fa'}),
    createSeasonOpacityControl('MAM', PARAMS.vis.MAM.color),
    createSeasonOpacityControl('JJA', PARAMS.vis.JJA.color),
    createSeasonOpacityControl('SON', PARAMS.vis.SON.color),
    createSeasonOpacityControl('DJF', PARAMS.vis.DJF.color),
    resetOpacityBtn
  ],
  style: {
    backgroundColor: '#f8f9fa', padding: '10px', border: '1px solid #e0e0e0', margin: '5px 0'
  }
});

var statusLabel = ui.Label('Status: Waiting for map click...', {
  color: '#555555', fontWeight: 'bold'
});

// Enhanced Inspector Panel
var inspectorPanel = ui.Panel({
  style: {
    position: 'bottom-right', padding: '12px', shown: false, width: '260px', 
    backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #ccc'
  }
});
Map.add(inspectorPanel);

var currentCombinedFc = null;

var chartTitle = ui.Label('Seasonal Statistics', {
  fontWeight: 'bold', fontSize: '16px', margin: '10px 0 4px 0'
});
var chartPanel = ui.Panel({style: {margin: '0', padding: '0'}});

var legendTitle = ui.Label('Map Legend', {
  fontWeight: 'bold', fontSize: '16px', margin: '10px 0 4px 0'
});
var legendPanel = ui.Panel({
  style: {padding: '10px', border: '1px solid #e0e0e0', backgroundColor: '#f8f9fa'}
});

function makeLegendRow(color, name) {
  var colorBox = ui.Label({
    style: {backgroundColor: '#' + color, padding: '8px', margin: '0 10px 4px 0', border: '1px solid #000'}
  });
  var description = ui.Label({
    value: name, style: {margin: '2px 0 4px 0', fontSize: '13px', backgroundColor: '#f8f9fa'}
  });
  return ui.Panel({
    widgets: [colorBox, description], layout: ui.Panel.Layout.Flow('horizontal'), style: {backgroundColor: '#f8f9fa'}
  });
}

legendPanel.add(makeLegendRow(PARAMS.vis.MAM.color, 'MAM (Mar - May)'));
legendPanel.add(makeLegendRow(PARAMS.vis.JJA.color, 'JJA (Jun - Aug)'));
legendPanel.add(makeLegendRow(PARAMS.vis.SON.color, 'SON (Sep - Nov)'));
legendPanel.add(makeLegendRow(PARAMS.vis.DJF.color, 'DJF (Dec - Feb)'));
legendPanel.add(makeLegendRow('FF0000', 'Agricultural region'));

panel.add(appTitle);
panel.add(appDesc);
panel.add(createDivider());
panel.add(settingsTitle);
panel.add(settingsPanel);
panel.add(createDivider());
panel.add(statusLabel);
panel.add(createDivider());
panel.add(chartTitle);
panel.add(chartPanel);
panel.add(createDivider());
panel.add(legendTitle);
panel.add(legendPanel);

ui.root.insert(0, panel);

// Base layers - Now bound directly to the initial states of the checkboxes
Map.addLayer(GAUL_DOMAIN.style(PARAMS.gaulStyle), {}, 'GAUL level2', gaulCheckbox.getValue());
Map.addLayer(DOMAIN, PARAMS.domainStyle, 'Valid domain (70N–70S)', false);
Map.addLayer(tileQuarters_DOMAIN.style(PARAMS.quarterTileStyle), {}, 'Cropland tiles', tilesCheckbox.getValue());


// -------------------------
// 3) HELPERS & CHARTING
// -------------------------
function safeNumberFromTextbox(tb, fallback) {
  var v = Number(tb.getValue());
  return (isFinite(v) && v > 0) ? v : fallback;
}

function edgeBufferPackFromBinary(binary, aoi) {
  var canny = ee.Algorithms.CannyEdgeDetector({image: binary, threshold: 1, sigma: 1});
  var connected = canny.updateMask(canny).lt(0.05).toByte().connectedPixelCount(EDGE_PIX_CONN, true);
  var edges = connected.gte(EDGE_LEN_MIN).toByte().rename('edges');
  var edgeBuffer = edges.fastDistanceTransform().lt(EDGE_BUFFER_M).toByte().rename('edge_buffer');
  return ee.Image.cat([edges, edgeBuffer]).clip(aoi);
}

var seasonalLayerNames = [
  'Selected Admin2', 'Drawn AOI', 'Selected Tile', 
  'Res MAM', 'Res JJA', 'Res SON', 'Res DJF', 'Agricultural region'
];

function clearSeasonLayers() {
  var layers = Map.layers();
  for (var i = layers.length() - 1; i >= 0; i--) {
    var nm = layers.get(i).getName();
    if (seasonalLayerNames.indexOf(nm) !== -1) Map.layers().remove(layers.get(i));
  }
}

function getIntersectingTileIds(aoi) {
  var aoi_tiles = tiles_DOMAIN.filterBounds(aoi);
  return ee.List(aoi_tiles.aggregate_array('ID2')).distinct();
}

function toB1(img) {
  img = ee.Image(img);
  var b = ee.Image(ee.Algorithms.If(img.bandNames().contains('b1'), img.select('b1'), img.select(0)));
  return b.rename('b1').gt(0).rename('b1').toByte();
}

function buildSeasonMosaic(seasonName, tileIds, year) {
  tileIds = ee.List(tileIds);
  var yearStr = ee.Number(year).format('%.0f');
  var basePrefixes = tileIds.map(function(id2) {
    return ee.String('SmallRes_').cat(ee.Number(id2).format('%.0f')).cat('_').cat(yearStr).cat('_').cat(seasonName);
  });

  function collectByPrefixes(ic, prefixes) {
    prefixes = ee.List(prefixes);
    var empty = ee.ImageCollection(ic).filter(ee.Filter.eq('system:index', '__NO_MATCH__'));
    return ee.ImageCollection(prefixes.iterate(function(p, acc) {
      return ee.ImageCollection(acc).merge(ee.ImageCollection(ic).filter(ee.Filter.stringContains('system:index', ee.String(p))));
    }, empty));
  }

  var fromSeason = collectByPrefixes(IC_SEASON[seasonName], basePrefixes).map(toB1);
  var fromRemaining = collectByPrefixes(IC_REMAINING, basePrefixes).map(toB1);
  var merged = fromSeason.merge(fromRemaining);

  return ee.Image(ee.Algorithms.If(merged.size().gt(0), merged.mosaic(), ee.Image(0).rename('b1').updateMask(ee.Image(0)))).rename('b1');
}

function buildSeasonStatsFC(seasonFcDict) {
  var seasons = ['MAM', 'JJA', 'SON', 'DJF'];
  var feats = seasons.map(function(s) {
    var fc = ee.FeatureCollection(seasonFcDict[s]);
    return ee.Feature(null, {season: s, count: fc.size(), area_m2: ee.Number(fc.aggregate_sum('area_m2'))});
  });
  return ee.FeatureCollection(feats);
}

// Rewritten charting to color-code bars automatically
function renderSeasonCharts(statsFC) {
  chartPanel.clear();

  // Pivot data so each season is a separate property
  var countDict = ee.Dictionary.fromLists(statsFC.aggregate_array('season'), statsFC.aggregate_array('count')).set('group', 'Count');
  var areaDict = ee.Dictionary.fromLists(
    statsFC.aggregate_array('season'), 
    statsFC.map(function(f){ return f.set('a', ee.Number(f.get('area_m2')).divide(1e6)) }).aggregate_array('a')
  ).set('group', 'Area');

  var pivotedFC_count = ee.FeatureCollection([ee.Feature(null, countDict)]);
  var pivotedFC_area = ee.FeatureCollection([ee.Feature(null, areaDict)]);

  var chartColors = ['#'+PARAMS.vis.MAM.color, '#'+PARAMS.vis.JJA.color, '#'+PARAMS.vis.SON.color, '#'+PARAMS.vis.DJF.color];

  var countChart = ui.Chart.feature.byFeature({
    features: pivotedFC_count, xProperty: 'group', yProperties: ['MAM', 'JJA', 'SON', 'DJF']
  })
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Reservoir count by season',
    legend: {position: 'none'},
    hAxis: {title: '', textPosition: 'none'},
    vAxis: {title: 'Count'},
    height: 180,
    colors: chartColors
  });

  var areaChart = ui.Chart.feature.byFeature({
    features: pivotedFC_area, xProperty: 'group', yProperties: ['MAM', 'JJA', 'SON', 'DJF']
  })
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Total reservoir area by season',
    legend: {position: 'none'},
    hAxis: {title: '', textPosition: 'none'},
    vAxis: {title: 'Area (km²)'},
    height: 180,
    colors: chartColors
  });

  chartPanel.add(countChart);
  chartPanel.add(areaChart);
}

// =========================================
// 4) RESERVOIR PROCESSING
// =========================================
function processReservoirsFromImage(img, aoiGeom, seasonName) {
  var mask = ee.Image(img).select('b1').gt(0).selfMask();
  var vectors = mask.reduceToVectors({
    geometry: aoiGeom, scale: PARAMS.scale, geometryType: 'polygon', eightConnected: true, maxPixels: 1e13
  });

  var filteredVectors = vectors.map(function(f) {
    return f.set('area_m2', f.geometry().area(PARAMS.scale));
  }).filter(ee.Filter.gt('area_m2', PARAMS.minArea)).filter(ee.Filter.lt('area_m2', PARAMS.maxArea));

  var cropMask = crop_DOMAIN.gt(0).selfMask().toByte();
  var edgePack = edgeBufferPackFromBinary(cropMask, aoiGeom);
  var edgeBufMask = edgePack.select('edge_buffer').unmask(0).toByte();

  var withEdgeFlag = edgeBufMask.reduceRegions({
    collection: filteredVectors, reducer: ee.Reducer.anyNonZero().setOutputs(['near_edge']), scale: PARAMS.scale, tileScale: 4
  });

  return withEdgeFlag.filter(ee.Filter.eq('near_edge', 0)).map(function(f) { return f.set('season', seasonName); });
}

// =========================================
// 5) CORE ANALYSIS HELPER & DRAWING TOOLS
// =========================================
function runAnalysis(aoiGeometry, labelName, zoomObj, selectionStyle) {
  clearSeasonLayers();
  inspectorPanel.style().set('shown', false);
  currentCombinedFc = null;

  PARAMS.minArea = safeNumberFromTextbox(minAreaBox, PARAMS.minArea);
  PARAMS.maxArea = safeNumberFromTextbox(maxAreaBox, PARAMS.maxArea);

  statusLabel.setValue('Status: applying domain constraint and computing...');
  statusLabel.style().set('color', '#555555');

  var aoiClipped = ee.Geometry(aoiGeometry).intersection(DOMAIN, ee.ErrorMargin(1));
  var isValid = aoiClipped.area(1).gt(0);
  var aoi = ee.Geometry(ee.Algorithms.If(isValid, aoiClipped, DOMAIN));

  Map.addLayer(
    ee.FeatureCollection(ee.Algorithms.If(isValid, ee.FeatureCollection([ee.Feature(aoiClipped)]), ee.FeatureCollection([])))
    .style(selectionStyle || PARAMS.selectedStyle), {}, labelName, true
  );

  var cropPreview = crop_DOMAIN.gt(0).selfMask();
  Map.addLayer(
    cropPreview, {min: 0, max: 1, palette: ['FF0000']}, 'Agricultural region', agRegionCheckbox.getValue(), 0.15
  );

  var tileIds = ee.List(ee.Algorithms.If(isValid, getIntersectingTileIds(aoi), ee.List([])));

  var seasonNames = ['MAM', 'JJA', 'SON', 'DJF'];
  var seasonFcs = {};
  var fcList = ee.List([]);

  seasonNames.forEach(function(s) {
    var mosaic = buildSeasonMosaic(s, tileIds, PARAMS.year).clip(aoi);
    var cleanFc = ee.FeatureCollection(ee.Algorithms.If(isValid, processReservoirsFromImage(mosaic, aoi, s), ee.FeatureCollection([])));

    seasonFcs[s] = cleanFc;
    fcList = fcList.add(cleanFc);
    var currentOpacity = opacitySliders[s].getValue();
    Map.addLayer(cleanFc, PARAMS.vis[s], 'Res ' + s, true, currentOpacity);
  });

  currentCombinedFc = ee.FeatureCollection(fcList).flatten();

  var statsFC = ee.FeatureCollection(ee.Algorithms.If(isValid, buildSeasonStatsFC(seasonFcs), ee.FeatureCollection([])));
  renderSeasonCharts(statsFC);

  Map.centerObject(aoi); 
  
  statusLabel.setValue('Status: done within valid domain (70°N to 70°S).');
  statusLabel.style().set('color', '#00AA00');
}

// -------------------------
// Drawing tools
// -------------------------
var drawingTools = Map.drawingTools();
drawingTools.setShown(false);
drawingTools.setLinked(false);

modeSelect.onChange(function(mode) {
  drawingTools.layers().forEach(function(layer) { layer.geometries().reset(); });

  if (mode === '3. Draw Rectangle (Custom AOI)') {
    drawingTools.setShown(true);
    drawingTools.setShape('rectangle');
    drawingTools.draw();
    statusLabel.setValue('Status: Draw a rectangle on the map (analysis limited to 70°N to 70°S).');
    statusLabel.style().set('color', '#555555');
  } else if (mode === '1. Select Tile (Tile Statistics)') {
    drawingTools.setShown(false);
    drawingTools.stop();
    statusLabel.setValue('Status: Click a tile to run the analysis.');
    statusLabel.style().set('color', '#555555');
  } else {
    drawingTools.setShown(false);
    drawingTools.stop();
  }
});

drawingTools.onDraw(function(geometry, layer) {
  var currentMode = modeSelect.getValue();
  if (currentMode !== '3. Draw Rectangle (Custom AOI)') return;

  var drawn = ee.Geometry(geometry);
  var clipped = drawn.intersection(DOMAIN, ee.ErrorMargin(1));

  clipped.area(1).evaluate(function(area) {
    if (!area || area <= 0) {
      statusLabel.setValue('Status: drawn AOI is outside the supported domain (70°N to 70°S).');
      statusLabel.style().set('color', '#d32f2f');
    } else {
      runAnalysis(clipped, 'Drawn AOI', clipped, PARAMS.selectedStyle);
    }
    layer.geometries().reset();
    drawingTools.setShape('rectangle');
    drawingTools.draw();
  });
});

// -------------------------
// 6) CLICK HANDLER
// -------------------------
Map.onClick(function(coords) {
  var currentMode = modeSelect.getValue();

  if (currentMode === '3. Draw Rectangle (Custom AOI)') return;

  if (coords.lat > 70 || coords.lat < -70) {
    statusLabel.setValue('Status: outside supported domain (70°N to 70°S).');
    statusLabel.style().set('color', '#d32f2f');

    inspectorPanel.style().set('shown', true);
    inspectorPanel.clear();
    
    var closeErrBtn = ui.Button({label: '✖', onClick: function() { inspectorPanel.style().set('shown', false); }, style: {margin: '0', padding: '0', color: '#555'}});
    var errHeader = ui.Panel([ui.Label('⚠️ Error', {fontWeight: 'bold', color: '#d32f2f', margin: '4px 0'}), closeErrBtn], ui.Panel.Layout.Flow('horizontal'), {stretch: 'horizontal'});
    
    inspectorPanel.add(errHeader);
    inspectorPanel.add(ui.Label('Outside supported domain: 70°N to 70°S'));
    return;
  }

  var pt = ee.Geometry.Point([coords.lon, coords.lat]);

  // ==========================================
  // MODE 4: CLICK ON RESERVOIR (Inspect Water)
  // ==========================================
  if (currentMode === '4. Click on Reservoir (Inspect Water)') {
    inspectorPanel.style().set('shown', true);
    inspectorPanel.clear();
    
    var closeBtn = ui.Button({
      label: '✖', onClick: function() { inspectorPanel.style().set('shown', false); }, style: {margin: '0', padding: '0', color: '#555'}
    });
    
    if (!currentCombinedFc) {
      var headerReq = ui.Panel([ui.Label('⚠️ Notice', {fontWeight: 'bold', color: '#d32f2f', margin: '4px 0'}), closeBtn], ui.Panel.Layout.Flow('horizontal'), {stretch: 'horizontal'});
      inspectorPanel.add(headerReq);
      inspectorPanel.add(ui.Label('Please Load a Region or Tile first.'));
      return;
    }

    inspectorPanel.add(ui.Label('🔍 Searching...', {color: 'gray', margin: '2px'}));

    var clickPt = ee.Geometry.Point([coords.lon, coords.lat]).buffer(15);
    var clickedRes = currentCombinedFc.filterBounds(clickPt);

    clickedRes.evaluate(function(featureCollection) {
      inspectorPanel.clear();
      var features = featureCollection.features;

      var headerRes = ui.Panel([
        ui.Label('💧 Reservoir Details', {fontWeight: 'bold', color: '#1a73e8', margin: '4px 0'}),
        closeBtn
      ], ui.Panel.Layout.Flow('horizontal'), {stretch: 'horizontal'});
      inspectorPanel.add(headerRes);

      if (!features || features.length === 0) {
        inspectorPanel.add(ui.Label('No reservoir found here.', {margin: '2px', color: '#555'}));
        return;
      }

      var seasonOrder = {'MAM': 1, 'JJA': 2, 'SON': 3, 'DJF': 4};
      features.sort(function(a, b) {
        return seasonOrder[a.properties.season] - seasonOrder[b.properties.season];
      });

      features.forEach(function(feat) {
        var s = feat.properties.season;
        var a = Math.round(feat.properties.area_m2).toLocaleString();

        var detailRow = ui.Panel([
          ui.Label(s + ':', {fontWeight: 'bold', margin: '2px 5px 2px 0', width: '45px'}),
          ui.Label(a + ' m²', {margin: '2px 0'})
        ], ui.Panel.Layout.Flow('horizontal'));
        inspectorPanel.add(detailRow);
      });
    });

    return;
  }

  // ==========================================
  // MODE 1: SELECT TILE (Tile Statistics)
  // ==========================================
  if (currentMode === '1. Select Tile (Tile Statistics)') {
    statusLabel.setValue('Status: finding tile at click...');
    statusLabel.style().set('color', '#555555');

    var quarterFc = tileQuarters_DOMAIN.filterBounds(pt);

    quarterFc.size().evaluate(function(n) {
      if (!n || n === 0) {
        statusLabel.setValue('Status: no tile found at clicked location.');
        statusLabel.style().set('color', '#d32f2f');
        return;
      }
      var quarter = ee.Feature(quarterFc.first());
      runAnalysis(quarter.geometry(), 'Selected Tile', quarter.geometry(), PARAMS.selectedQuarterStyle);
    });
    return;
  }

  // ==========================================
  // MODE 2: SELECT REGION (Region Statistics)
  // ==========================================
  if (currentMode === '2. Select Region (Region Statistics)') {
    statusLabel.setValue('Status: finding admin2 at click...');
    statusLabel.style().set('color', '#555555');

    var admin2Fc = GAUL_DOMAIN.filterBounds(pt);

    admin2Fc.size().evaluate(function(n) {
      if (!n || n === 0) {
        statusLabel.setValue('Status: no GAUL level-2 region found at clicked location.');
        statusLabel.style().set('color', '#d32f2f');
        return;
      }
      var admin2 = ee.Feature(admin2Fc.first());
      runAnalysis(admin2.geometry(), 'Selected Admin2', pt, PARAMS.selectedStyle);
    });
  }
});
