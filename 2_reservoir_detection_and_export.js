/***********************
 * SMALL RESERVOIRS — Batched runner
 * - Fuses S2 & S1 adaptive water masks
 * - Builds one mask for 300–100,000 m²
 * - Exports per tile × season × year (Vector and/or GeoTIFF)
 ***********************/

// ---------------- INPUTS ----------------
var tiles = ee.FeatureCollection('[YOUR_ASSET_PATH]/Tiles_filtered_ESA_crop');
tiles = tiles.sort('ID2');  
Map.addLayer(tiles, {}, 'Tiles');

// ============== USER TOGGLES ==============
var YEARS   = ['2024'];

var SEASONS = [
  { name:'MAM', start:'-03-01', end:'-06-01' },
  { name:'JJA', start:'-06-01', end:'-09-01' },
  { name:'SON', start:'-09-01', end:'-12-01' }, 
  { name:'DJF', start:'-12-01', end:'-03-01' }
];

// Cropland mask
var croplandFiltered = ee.Image('[YOUR_ASSET_PATH]/croplandFiltered_Global_100m');
var APPLY_CROPLAND   = true;

// Small reservoir size range (m²)
var SMALL_MIN = 300;
var SMALL_MAX = 100000;

// Export settings
var OUT_FOLDER     = 'GEE_Water_Test_Exports';
var OUT_FORMAT     = 'SHP';       // 'SHP' or 'GeoJSON' (for vector export)
var EXPORT_SCALE   = 10;          // 10 m (detailed, slower) or 100 m (faster, coarser)
var EXPORT_VECTOR  = true;        // toggle vector export on/off
var EXPORT_TIFF    = false;       // toggle GeoTIFF export on/off
var COG            = true;        // Cloud Optimized GeoTIFF (when EXPORT_TIFF = true)
var TIFF_CRS       = 'EPSG:4326'; // change if needed

// Detection params
var INIT_NDWI = 0.0;     // initial NDWI threshold (before Otsu)
var INIT_VV   = -18;     // initial S1 VV threshold (dB) (before Otsu)

// Edge/buffer params for local Otsu
var EDGE_PIX_CONN = 100;
var EDGE_LEN_MIN  = 20;
var EDGE_BUFFER_M = 30;

// ============== HELPERS ==============
function getSeasonDates(year, season) {
  if (season.name === 'DJF') {
    return { start: year + '-12-01', end: (parseInt(year,10)+1) + '-03-01' };
  } else {
    return { start: year + season.start, end: year + season.end };
  }
}

// Classical Otsu on histogram dictionary
function otsu(histDict) {
  histDict = ee.Dictionary(histDict);
  var counts = ee.Array(histDict.get('histogram'));
  var means  = ee.Array(histDict.get('bucketMeans'));
  var total  = counts.reduce(ee.Reducer.sum(), [0]).get([0]);
  var sum    = means.multiply(counts).reduce(ee.Reducer.sum(), [0]).get([0]);
  var mean   = sum.divide(total);
  var size   = means.length().get([0]);
  var idx    = ee.List.sequence(1, size);
  var bss = idx.map(function(i) {
    var aCounts = counts.slice(0, 0, i);
    var aCount  = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
    var aMeans  = means.slice(0, 0, i);
    var aMean   = aMeans.multiply(aCounts).reduce(ee.Reducer.sum(), [0]).get([0]).divide(aCount);
    var bCount  = ee.Number(total).subtract(aCount);
    var bMean   = ee.Number(sum).subtract(aCount.multiply(aMean)).divide(bCount);
    return aCount.multiply(aMean.subtract(mean).pow(2))
                 .add(bCount.multiply(bMean.subtract(mean).pow(2)));
  });
  return means.sort(bss).get([-1]);
}

function terrainMask(aoi) {
  var dem = ee.Image('USGS/SRTMGL1_003');
  var slope = ee.Terrain.slope(dem);
  var elevation = dem;
  return slope.lt(15).and(elevation.lt(2500));
}

function s2SeasonalForNDWI(aoi, start, end) {
  var s2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(function(img) {
      return img.divide(10000)
        .select(['B3','B2','B8','B11'], ['green','blue','nir','swir'])
        .copyProperties(img, ['system:time_start']);
    });
  var med  = s2.median().clip(aoi);
  var ndwi = med.normalizedDifference(['green','nir']).rename('ndwi');
  return med.addBands(ndwi);
}

function s2YearlyComposite(aoi, year) {
  var start = year + '-01-01';
  var end   = (parseInt(year,10) + 1) + '-01-01';
  var s2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(function(img) {
      return img.divide(10000)
        .select(['B2','B3','B4','B8','B11'], ['blue','green','red','nir','swir']);
    });
  var med = s2.median().clip(aoi);
  var ndviY = med.normalizedDifference(['nir','red']).rename('ndvi_year');
  var ndbiY = med.normalizedDifference(['swir','nir']).rename('ndbi_year');
  return med.addBands([ndviY, ndbiY]);
}

// SAFE Sentinel-1: always return an image that has a 'VV' band
function s1MedianComposite(aoi, start, end) {
  var coll = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi)
    .filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode','IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VV'))
    .select('VV');

  var vv = ee.Image(ee.Algorithms.If(
    coll.size().gt(0),
    coll.mean().rename('VV'),
    ee.Image(0).rename('VV').updateMask(ee.Image(0)) // fully masked placeholder
  ));
  return vv.clip(aoi);
}

function otsuFromMask(img, band, aoi, scale, mask, fallback) {
  var reducer = ee.Reducer.histogram({maxBuckets:255, minBucketWidth:0.01});
  var target = img.select(band);
  if (mask) target = target.updateMask(mask);
  var d = ee.Dictionary(target.reduceRegion({
    reducer: reducer, geometry: aoi, scale: scale,
    maxPixels: 1e10, bestEffort: true, tileScale: 4
  }).get(band));
  var hasHist = d.contains('histogram');
  return ee.Number(ee.Algorithms.If(hasHist, otsu(d), fallback));
}

function edgeBufferPackFromBinary(binary, aoi) {
  var canny = ee.Algorithms.CannyEdgeDetector({image: binary, threshold: 1, sigma: 1});
  var connected = canny.updateMask(canny).lt(0.05).toByte()
                  .connectedPixelCount(EDGE_PIX_CONN, true);
  var edges = connected.gte(EDGE_LEN_MIN).toByte().rename('edges');
  var edgeBuffer = edges.fastDistanceTransform().lt(EDGE_BUFFER_M)
                   .toByte().rename('edge_buffer');
  return ee.Image.cat([edges, edgeBuffer]).clip(aoi);
}

// ===== Adaptive water masks =====
function s2WaterAdaptive(aoi, start, end, year) {
  var s2det = s2SeasonalForNDWI(aoi, start, end);
  var ndwi  = s2det.select('ndwi');
  var swir  = s2det.select('swir');
  var yearly = s2YearlyComposite(aoi, year);
  var ndviY  = yearly.select('ndvi_year');
  var ndbiY  = yearly.select('ndbi_year');

  var prelim = ndwi.gt(INIT_NDWI).toByte();
  var edgePack = edgeBufferPackFromBinary(prelim, aoi);
  var edgeBuf  = edgePack.select('edge_buffer');

  var localT = otsuFromMask(ndwi, 'ndwi', aoi, 90, edgeBuf, INIT_NDWI);
  var waterAdaptive = ndwi.gt(localT);

  var tm        = terrainMask(aoi);
  var nonVeg    = ndviY.lt(0);
  var nonBuilt  = ndbiY.lt(0.2);
  var swirMask  = swir.lt(0.08);

  var mask = waterAdaptive.and(tm).and(nonVeg).and(nonBuilt).and(swirMask);
  var clean = mask.focal_min(1).focal_max(1).focal_max(1).focal_min(1)
                   .gt(0).toByte().rename('waterS2');

  return ee.Dictionary({ water: clean, edgePack: edgePack, adaptiveT: localT });
}

function s1WaterAdaptive(aoi, start, end, year) {
  var vv = s1MedianComposite(aoi, start, end);

  var prelim = vv.lt(INIT_VV).toByte();
  var edgePack = edgeBufferPackFromBinary(prelim, aoi);
  var edgeBuf  = edgePack.select('edge_buffer');

  var localT = otsuFromMask(vv, 'VV', aoi, 90, edgeBuf, INIT_VV);
  var waterAdaptive = vv.lt(localT);

  var yearly = s2YearlyComposite(aoi, year);
  var ndviY  = yearly.select('ndvi_year');
  var ndbiY  = yearly.select('ndbi_year');

  var tm        = terrainMask(aoi);
  var nonVeg    = ndviY.lt(0);
  var nonBuilt  = ndbiY.lt(0);

  var mask = waterAdaptive.and(tm).and(nonVeg).and(nonBuilt);
  var clean = mask.focal_min(1).focal_max(1).focal_max(1).focal_min(1)
                   .gt(0).toByte().rename('waterS1');

  return ee.Dictionary({ water: clean, edgePack: edgePack, adaptiveT: localT });
}

// Label & size-filter helper used to make a single small-reservoir mask
function labeledReservoirs(waterMaskByte, minM2, maxM2, region) {
  var w = waterMaskByte.gt(0).toByte();
  var cc    = w.selfMask().connectedComponents(ee.Kernel.plus(1), 110); // 'labels'
  var count = cc.select('labels').connectedPixelCount(110).rename('pix_ct');
  var areaM2   = count.multiply(ee.Image.pixelArea());
  var areaMask = areaM2.gte(minM2).and(areaM2.lte(maxM2));
  var labelsOK = cc.updateMask(areaMask);
  var maskOK   = areaMask.updateMask(areaMask).toByte().rename('smallRes');
  return ee.Dictionary({ mask: maskOK, labels: labelsOK });
}

function smallReservoirMask(fusedImage, aoi) {
  var res = labeledReservoirs(fusedImage, SMALL_MIN, SMALL_MAX, aoi);
  return ee.Image(res.get('mask')).rename('smallRes');
}

// Add geometry attributes to each polygon (for vector export)
function addGeomAttributes(f) {
  var g = f.geometry();
  var area_m2 = g.area(1);
  var area_ha = area_m2.divide(10000);
  var perimeter_m = g.perimeter(1);
  var centroid = g.centroid({'maxError': 1});
  var lonlat = centroid.coordinates();

  var labelStr = ee.String(ee.Algorithms.If(f.get('label'), f.get('label'), ''));
  var serial = ee.Algorithms.String(labelStr).length().gt(0)
      ? ee.Number.parse(labelStr).int64()
      : ee.Number.parse(ee.String(f.id()).replace('[^0-9]', '')).int64();

  return f.set({
    area_m2: area_m2,
    area_ha: area_ha,
    perimeter_m: perimeter_m,
    cx: lonlat.get(0),
    cy: lonlat.get(1),
    serial: serial
  });
}

// ============== CORE RUNNER FOR ONE AOI ==============
function runForAOI(aoiGeom, aoiName, year, season) {
  var sd = getSeasonDates(year, season).start;
  var ed = getSeasonDates(year, season).end;

  // --- Build fused water mask (use S2 alone if S1 has no water) ---
  var s2 = ee.Image(s2WaterAdaptive(aoiGeom, sd, ed, year).get('water')); // band: 'waterS2'
  var s1 = ee.Image(s1WaterAdaptive(aoiGeom, sd, ed, year).get('water')); // band: 'waterS1'

  // Count S1 water pixels inside the AOI (treat masked as 0)
  var s1WaterPx = ee.Number(
    s1.unmask(0).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoiGeom,
      scale: EXPORT_SCALE,
      maxPixels: 1e12,
      bestEffort: true,
      tileScale: 4
    }).get('waterS1')
  );
  

  // If S1 has any water, fuse S2 ∪ S1; otherwise just use S2
  var fused = ee.Image(ee.Algorithms.If(
    s1WaterPx.gt(0),
    s2.unmask(0).or(s1.unmask(0)),
    s2
  )).rename('waterFused').toByte();

  // --- One small-reservoir mask for FULL range ---
  var maskSmall = smallReservoirMask(fused, aoiGeom);
  var maskForExport = APPLY_CROPLAND ? maskSmall.updateMask(croplandFiltered) : maskSmall;

  // --------- Exports ---------
  var fileBase = 'SmallRes_' + aoiName + '_' + year + '_' + season.name +
                 '_m' + SMALL_MIN + '_' + SMALL_MAX;

  if (EXPORT_VECTOR) {
    var vectors = maskForExport.selfMask().reduceToVectors({
        geometry: aoiGeom,
        scale: EXPORT_SCALE,
        geometryType: 'polygon',
        labelProperty: 'label',
        maxPixels: 1e10,
        bestEffort: true
      })
      .map(function(f) {
        return addGeomAttributes(f).set({
          tile_name: aoiName,
          year: year,
          season: season.name,
          min_m2: SMALL_MIN,
          max_m2: SMALL_MAX,
          cropland_masked: APPLY_CROPLAND,
          export_scale: EXPORT_SCALE
        });
      });

    Export.table.toDrive({
      collection: vectors,
      description: fileBase + '_VEC',
      folder: OUT_FOLDER,
      fileFormat: OUT_FORMAT
    });
  }

  if (EXPORT_TIFF) {
    // Ensure binary 0/1 for export and add basic metadata
    var exportStartEE = ee.Date(Date.now()).format("YYYY-MM-dd'T'HH:mm:ss");
    var outImage = maskForExport
        .rename('smallRes')
        .unmask(0)
        .toInt8()
        .set({
          tile_name: aoiName,
          year: year,
          season: season.name,
          min_m2: SMALL_MIN,
          max_m2: SMALL_MAX,
          cropland_masked: APPLY_CROPLAND,
          export_scale: EXPORT_SCALE,
          export_requested_at_iso: exportStartEE
        })
        .clip(aoiGeom);

    Export.image.toDrive({
      image: outImage,
      description: fileBase + '_TIFF',
      folder: OUT_FOLDER,
      fileNamePrefix: fileBase,
      region: aoiGeom,
      scale: EXPORT_SCALE,
      crs: TIFF_CRS,
      maxPixels: 1e13,
      fileFormat: 'GeoTIFF',
      formatOptions: COG ? {cloudOptimized: true} : {}
    });
  }
}

// ============== RUNNER: control how many tiles you schedule ==============
Map.setOptions('SATELLITE');

// Get tiles as a list for client-side iteration (needed for Export.* inside loop)
var tileList = tiles.toList(tiles.size());
var nTiles   = tileList.size().getInfo();  // client-side length

// ---- Controls ----
var RUN_MODE   = 'BATCH';   // 'BATCH' | 'INDEX_RANGE' | 'ID_LIST' | 'ALL'

// For RUN_MODE = 'BATCH'
var BATCH_SIZE = 20;        // how many tiles per run
var BATCH_IDX  = 63;        // 0-based batch index: 0,1,2,...

// For RUN_MODE = 'INDEX_RANGE'
var START_IDX  = 15;        // inclusive
var END_IDX    = 20;        // exclusive

// For RUN_MODE = 'ID_LIST' (must match your tiles' ID2 values)
var ID2_LIST   = ['173','187','188','189','179','202','218','216','224','238','240','241','237','244','253','255'];  // example

// ---- Build the subset to process ----
var subsetFC;
if (RUN_MODE === 'BATCH') {
  var start = Math.max(BATCH_IDX * BATCH_SIZE, 0);
  var end   = Math.min(start + BATCH_SIZE, nTiles);
  var subList = tileList.slice(start, end);
  subsetFC = ee.FeatureCollection(subList);
  print('BATCH mode — indices:', start, 'to', end - 1, 'of', nTiles - 1);
} else if (RUN_MODE === 'INDEX_RANGE') {
  var s = Math.max(START_IDX, 0);
  var e = Math.min(END_IDX, nTiles);
  var subList2 = tileList.slice(s, e);
  subsetFC = ee.FeatureCollection(subList2);
  print('INDEX_RANGE mode — indices:', s, 'to', e - 1, 'of', nTiles - 1);
} else if (RUN_MODE === 'ID_LIST') {
  var ID2_NUM = ee.List(ID2_LIST).map(function(x){ return ee.Number.parse(ee.String(x)); });
  subsetFC = tiles.filter(ee.Filter.inList('ID2', ID2_NUM));
  print('ID_LIST mode — ID2s:', ID2_LIST);
} else { // 'ALL'
  subsetFC = tiles;
  print('ALL tiles mode');
}

Map.centerObject(subsetFC.geometry(), 6);
print('Tiles selected:', subsetFC.size());

// Client-side loop over just the selected subset
var subsetList = subsetFC.toList(subsetFC.size());
var m = subsetList.size().getInfo();

YEARS.forEach(function(year) {
  SEASONS.forEach(function(season) {
    for (var i = 0; i < m; i++) {
      var tile = ee.Feature(subsetList.get(i));
      var geom = tile.geometry();

      // Use ID2 exactly as stored on the tile
      var nameProp = ee.String(tile.get('ID2')).getInfo();

      runForAOI(geom, nameProp, year, season);
    }
  });
});
