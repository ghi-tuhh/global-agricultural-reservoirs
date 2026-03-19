// ================================================
// 1. Create the Cropland Mask (from ESA & ESRI)
// ================================================

// Load datasets
var esa20 = ee.ImageCollection("ESA/WorldCover/v100");
var esa21 = ee.ImageCollection("ESA/WorldCover/v200");
var esri_17_23 = ee.ImageCollection("projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS");

// Create ESA cropland masks (cropland class = 40)
var esa20_cropland = ee.Image(esa20.first()).eq(40).rename('Map');
var esa21_cropland = ee.Image(esa21.first()).eq(40).rename('Map');

// Create ESRI cropland masks (cropland class = 5) and get union over 2017-2023
var esri_cropland_masks = esri_17_23
  .filterDate('2017-01-01', '2023-12-31')
  .map(function(img) {
    return img.eq(5).rename('Map');
  });
var esri_cropland_union = esri_cropland_masks.max();

// Combine ESA and ESRI cropland masks (union)
var final_cropland_union = ee.ImageCollection([
  esa20_cropland, 
  esa21_cropland, 
  esri_cropland_union
]).max();

//Filling and offsetting cropland
var filled = final_cropland_union.focal_mean({radius: 200, kernelType: 'circle', units: 'meters'});
var ones = filled.gt(0).selfMask();
Map.addLayer(ones, {palette: ['pink']}, 'Original Croplannd after filling', false);


// ================================================
// 2. Create a Mask for Large Water Bodies (Including Lakes)
// ================================================

// Build water masks from ESA (water class = 80) and ESRI (water class = 1)
var esa20_water = ee.Image(esa20.first()).eq(80).rename('Map');
var esa21_water = ee.Image(esa21.first()).eq(80).rename('Map');
var esri_water_masks = esri_17_23
  .filterDate('2017-01-01', '2023-12-31')
  .map(function(img) {
    return img.eq(1).rename('Map');
  });
var esri_water_union = esri_water_masks.max();

// Combine ESA and ESRI water masks (union)
var final_water_union = ee.ImageCollection([
  esa20_water, 
  esa21_water, 
  esri_water_union
]).max();

// Reproject the water mask to 30m resolution
var waterMaskCoarse = final_water_union
  .reproject({crs: final_water_union.projection(), scale: 30});

// Identify connected water bodies using an 8-connected kernel.
var connectedWater = waterMaskCoarse.connectedComponents({
  connectedness: ee.Kernel.plus(1),
  maxSize: 1024
});
var labelsInt = connectedWater.select('labels').toInt16();

// Compute pixel area (in m²) and add as a band.
var areaImage = ee.Image.pixelArea().rename('area');
var combinedImage = areaImage.addBands(labelsInt);

// For each connected component, sum the pixel areas.
var waterStats = combinedImage.reduceConnectedComponents({
  reducer: ee.Reducer.sum(),
  labelBand: 'labels'
});

// Create a binary mask for water bodies above a threshold (e.g., ≥ 1e5 m²)
var largeWaterMask = waterStats.select('area').gte(1e5);
var largeWaterMask = largeWaterMask.gt(0).rename('Map');

Map.addLayer(largeWaterMask.selfMask(), {palette: ['cyan']}, 'Large Water Bodies', false);

// ----- Include Lakes from GLOBathy -----
// Load GLOBathy bathymetry and smooth it.
var globathy = ee.Image("projects/sat-io/open-datasets/GLOBathy/GLOBathy_bathymetry")
                .focal_mean({radius: 100, kernelType: 'circle', units: 'meters'});
// Create a lake mask (pixels with bathymetry > 0)
var lakeMask = globathy.gt(0).rename('Map');
Map.addLayer(lakeMask.selfMask(), {palette: ['cyan']}, 'Lakes');


// ================================================
// 3. Create a River and Shoreline Mask
// ================================================

// --- Using MERIT Hydro for rivers ---
var meritDataset = ee.Image('MERIT/Hydro/v1_0_1');
var wth = meritDataset.select('wth'); // river width
var upa = meritDataset.select('upa'); // upstream area

// Basic major river mask: river pixels with width > 0 and upa >= 500
var majRiv = wth.gt(0).and(upa.gte(500));

// Create focal mean images for different river width ranges.
var r10  = wth.gt(0).and(wth.lte(20)).and(upa.gte(500))
            .focal_mean({radius: 30,  kernelType: 'circle', units: 'meters'});  // buffer 20m for narrow canals each side
var r50  = wth.gt(20).and(wth.lte(100)).and(upa.gte(500))
            .focal_mean({radius: 100, kernelType: 'circle', units: 'meters'});
var r100 = wth.gt(100).and(wth.lte(200)).and(upa.gte(500))
            .focal_mean({radius: 150, kernelType: 'circle', units: 'meters'});
var r150 = wth.gt(200).and(wth.lte(300)).and(upa.gte(500))
            .focal_mean({radius: 200, kernelType: 'circle', units: 'meters'});
var r200 = wth.gt(300).and(wth.lte(400)).and(upa.gte(500))
            .focal_mean({radius: 250, kernelType: 'circle', units: 'meters'});
var r250 = wth.gt(400).and(wth.lte(500)).and(upa.gte(500))
            .focal_mean({radius: 300, kernelType: 'circle', units: 'meters'});
var r300 = wth.gt(500).and(wth.lte(600)).and(upa.gte(500))
            .focal_mean({radius: 350, kernelType: 'circle', units: 'meters'});
var r350 = wth.gt(600).and(wth.lte(700)).and(upa.gte(500))
            .focal_mean({radius: 400, kernelType: 'circle', units: 'meters'});
var r400 = wth.gt(700).and(wth.lte(800)).and(upa.gte(500))
            .focal_mean({radius: 450, kernelType: 'circle', units: 'meters'});
var r450 = wth.gt(800).and(wth.lte(900)).and(upa.gte(500))
            .focal_mean({radius: 500, kernelType: 'circle', units: 'meters'});
var r500 = wth.gt(900).and(wth.lte(1000)).and(upa.gte(500))
            .focal_mean({radius: 550, kernelType: 'circle', units: 'meters'});
var r600 = wth.gt(1000).and(upa.gte(500))
            .focal_mean({radius: 800, kernelType: 'circle', units: 'meters'});

// Combine all focal mean images.
var focalCollection = ee.ImageCollection([r10, r50, r100, r150, r200, r250, r300, r350, r400, r450, r500, r600]);
var combinedFocal = focalCollection.max();

// Create a binary river mask (any pixel with focal value > 0)
var riverMask = combinedFocal.gt(0).rename('Map');

// --- Add OSM water layer to capture ocean shorelines (if desired) ---
var osmWater = ee.ImageCollection("projects/sat-io/open-datasets/OSM_waterLayer")
  .median()
  .eq(1)
  .selfMask()
  .focal_mean({radius: 100, kernelType: 'circle', units: 'meters'});
var osmWaterMask = osmWater.gt(0).rename('Map');

Map.addLayer(riverMask.selfMask(), {palette: ['blue']}, 'Rivers');
Map.addLayer(osmWaterMask.selfMask(), {palette: ['blue']}, 'Shoreline');


// ================================================
// 4. Create Masks for Urban, Wetlands, Forest
// ================================================

// Create ESA cropland masks (cropland class = 40)
var esa20_cropland = ee.Image(esa20.first()).eq(40).rename('Map');
var esa21_cropland = ee.Image(esa21.first()).eq(40).rename('Map');

// Create ESRI cropland masks (cropland class = 5) and get union over 2017-2023
var esri_non_crop = esri_17_23
  .filterDate('2017-01-01', '2023-12-31')
  .map(function(img) {
    return img.eq(4)
      .or(img.eq(7))
      .or(img.eq(9))
      .rename('Map');
  });
var esri_non_crop = esri_non_crop.max();

var esa20_non_crop = esa20
  .map(function(img){
    return img.eq(50)
      .or(img.eq(90))
      .or(img.eq(95))
      .or(img.eq(100))
      .or(img.eq(70))
      .rename('Map');
  });
  
var esa20_non_crop = esa20_non_crop.max();

var esa21_non_crop = esa21
  .map(function(img){
    return img.eq(50)
      .or(img.eq(90))
      .or(img.eq(95))
      .or(img.eq(100))
      .or(img.eq(70))
      .rename('Map');
  });
  
var esa21_non_crop = esa21_non_crop.max();

// Combine ESA and ESRI non-crop masks (union)
var final_non_crop_union = ee.ImageCollection([
  esri_non_crop, 
  esa20_non_crop, 
  esa21_non_crop
]).max();


// ================================================
// 5. Filter Cropland: Remove Large Water (incl. Lakes) & Rivers/Shoreline, Urban, Wetlands, Forests
// ================================================

// Exclude pixels that fall into either the combined large water bodies (including lakes) or river/shoreline masks.
var croplandFiltered = ones
  .updateMask(lakeMask.unmask(0).not())
  .updateMask(riverMask.unmask(0).not())
  .updateMask(osmWaterMask.unmask(0).not())
  .updateMask(final_non_crop_union.unmask(0).not());

// Visualize the result.
Map.addLayer(croplandFiltered.selfMask(), {palette: ['green']}, 'Filtered Cropland');

// ================================================
// (Optional) Export or further process the filtered cropland.
// ================================================
var tiles = ee.FeatureCollection('[YOUR_ASSET_PATH]/Tiles_With_Cropland');
