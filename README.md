# Global Mapping of Small Agricultural Reservoirs

This repository contains the Google Earth Engine (GEE) JavaScript code used to detect, filter, and analyze small agricultural reservoirs globally (March 2024 – February 2025). 

These scripts accompany the paper: **"Global mapping of small agricultural reservoirs reveals a hidden water storage network."**

## Repository Structure

1. **`1_cropland_filtering.js`**: Generates a refined global cropland mask. It fuses ESA WorldCover and ESRI Land Cover datasets, then actively excludes large water bodies (including lakes), rivers, shorelines, urban areas, wetlands, and forests to minimize false positives in agricultural water detection.
2. **`2_reservoir_detection_and_export.js`**: The core detection algorithm. It fuses Sentinel-1 (SAR) and Sentinel-2 (Optical) imagery using adaptive local Otsu thresholding to identify water bodies between 300 and 100,000 m². This script handles batched processing and exports results per tile and season.
3. **`3_interactive_filtering_app.js`**: An interactive Google Earth Engine UI application. It allows users to click on specific regions or draw custom Areas of Interest (AOIs) to calculate and visualize seasonal agricultural reservoir statistics using the pre-computed raster outputs.

## Usage Instructions

To run these scripts, you must have a [Google Earth Engine](https://earthengine.google.com/) account. 

1. Open the [GEE Code Editor](https://code.earthengine.google.com/).
2. Copy the contents of the desired script into the code editor.
3. **Important:** Before running, you must replace the placeholder `[YOUR_ASSET_PATH]` in the scripts with the actual path to your uploaded GEE assets (e.g., your tile grids or pre-computed raster collections).
4. Click **Run**.
