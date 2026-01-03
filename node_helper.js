/*
 * MagicMirror²
 * Node Helper: MMM-ImagesPhotos
 *
 * By Rodrigo Ramìrez Norambuena https://rodrigoramirez.com
 * MIT Licensed.
 */

const express = require("express");
const console = require("console");
const NodeHelper = require("node_helper");
const path = require("path");
const fs = require("fs");
const mime = require("mime-types");
const getAverageColor = require('fast-average-color-node');
const exifParser = require("exif-parser");
const https = require("https");
const { spawn } = require("child_process");

async function reverseGeocode(lat, lon, language) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "nominatim.openstreetmap.org",
      path: `/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=${language}`,
      headers: {
        "User-Agent": "MagicMirror/MMM-ImagesPhotos-Module"
      }
    };

    const req = https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const jsonData = JSON.parse(data);
          if (jsonData && jsonData.error) {
            reject(new Error(jsonData.error));
          } else {
            resolve(jsonData);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", (e) => {
      reject(e);
    });
  });
}

module.exports = NodeHelper.create({
  // Override start method.
  config: {},
  path_images: {},

  buildLocationString(address, displayName) {
    const locationParts = [];
    const fields = ["road", "suburb", "village", "town", "city", "county", "state", "country"];

    fields.forEach((field) => {
      if (address[field]) {
        locationParts.push(address[field]);
      }
    });

    if (locationParts.length > 0) {
      return locationParts.join(", ");
    }

    return displayName;
  },

  async runFaceDetection(imagePath, id) {
    return new Promise((resolve, reject) => {
      if (!this.config[id].faceDetection || !this.config[id].faceDetectionScript) {
        resolve(null);
        return;
      }

      console.log(`[MMM-ImagesPhotos] Running python script: ${this.config[id].faceDetectionScript}, File: ${imagePath}`);
      const python = spawn("python", [this.config[id].faceDetectionScript, imagePath]);
      let dataString = "";
      let errorString = "";

      python.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      python.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      python.on("close", (code) => {
        if (code !== 0) {
          console.error(`[MMM-ImagesPhotos] Face detection script for ${imagePath} exited with code ${code}: ${errorString}`);
          resolve(null);
        } else {
          console.log(`[MMM-ImagesPhotos] Python script result for ${imagePath}: ${dataString}`);
          try {
            const faceData = JSON.parse(dataString);
            console.log(`[MMM-ImagesPhotos] Face detection result for ${imagePath}:`, JSON.stringify(faceData));
            resolve(faceData);
          } catch (e) {
            console.error(`[MMM-ImagesPhotos] Face detection - Invalid JSON from script for ${imagePath}: ${dataString}`);
            resolve(null);
          }
        }
      });

      python.on("error", (err) => {
        console.error(`[MMM-ImagesPhotos] Failed to start face detection script for ${imagePath}`, err);
        resolve(null); // Resolve with null to avoid breaking Promise.all
      });
    });
  },

  
  start() {
    console.log(`Starting node helper for: ${this.name}`);
  },

  setConfig(id) {
    console.log(`setconfig path=${id}`);
    this.path_images[id] = path.resolve(
      global.root_path,
      "modules/MMM-ImagesPhotos/uploads",
      this.config[id].path
    );
    console.log(`path for : ${this.name} ${id}= ${this.path_images[id]}`);
  },

  // Override socketNotificationReceived method.
  async socketNotificationReceived(notification, payload) {
    if (notification === "CONFIG") {
      console.log(`Config based debug=${payload.id}`);
      this.config[payload.id] = payload;
      this.setConfig(payload.id);
      this.extraRoutes(payload.id);
      this.sendSocketNotification("READY", payload.id);
    }
    if (notification === "GET_METADATA") {
      const { id, photo } = payload;
      const directoryImages = this.path_images[id];
      const imagePath = path.join(directoryImages, photo.path);

      const photoObject = {
        ...photo,
        exif: null,
        location: null,
        face: null
      };

      try {
        // Process EXIF and GPS if enabled
        if (this.config[id].showExif) {
          try {
            const fileBuffer = fs.readFileSync(imagePath);
            const parser = exifParser.create(fileBuffer);
            photoObject.exif = parser.parse();
          } catch (error) {
            console.error(`[MMM-ImagesPhotos] Could not parse EXIF for ${photo.path}:`, error.message);
          }

          if (photoObject.exif && photoObject.exif.tags && photoObject.exif.tags.GPSLatitude && photoObject.exif.tags.GPSLongitude) {
            try {
              const locationData = await reverseGeocode(photoObject.exif.tags.GPSLatitude, photoObject.exif.tags.GPSLongitude, this.config[id].language);
              if (locationData && locationData.address) {
                photoObject.location = this.buildLocationString(locationData.address, locationData.display_name);
              }
            } catch (e) {
              console.error(`[MMM-ImagesPhotos] Could not reverse geocode for ${photo.path}:`, e.message);
            }
          }
        }

        // Process face detection
        if (this.config[id].faceDetection) {
          photoObject.face = await this.runFaceDetection(imagePath, id);
        }

        this.sendSocketNotification("METADATA_RESPONSE", { id: id, photo: photoObject });
      } catch (e) {
        console.error(`[MMM-ImagesPhotos] Error processing metadata for ${photo.path}:`, e);
      }
    }
  },

  /*
   * Create routes for module manager.
   * Recive request and send response
   */
  extraRoutes(id) {
    console.log(`setting path=${id}`);
    const self = this;

    this.expressApp.get(`/MMM-ImagesPhotos/photos/${id}`, (req, res) => {
      self.getPhotosImages(req, res, id);
    });

    this.expressApp.use(
      `/MMM-ImagesPhotos/photo/${id}`,
      express.static(self.path_images[id])
    );
  },

  // Return photos-images by response in JSON format.
  getPhotosImages(req, res, id) {
    console.log(`gpi id=${id}`);
    const directoryImages = this.path_images[id];

    const imgs = this.getImages(this.getFiles(directoryImages, id), id);
    
    const initialPhotos = imgs.map((img) => ({
      url: `/MMM-ImagesPhotos/photo/${id}/${img}`,
      path: img // Keep the relative path for requests
    }));
    res.send(initialPhotos);
  },

  // Return array with only images
  getImages(files, id) {
    console.log(`gp id=${id}`);
    const images = [];
    const enabledTypes = ["image/jpeg", "image/png", "image/gif", "image/heic"];

    for (const idx in files) {
      if (idx in files) {
        const type = mime.lookup(files[idx]);
        if (enabledTypes.indexOf(type) >= 0 && type !== false) {
          images.push(files[idx]);
        }
      }
    }

    return images;
  },

  getFiles(filePath, id) {
    console.log(`gf id=${id}`);
    let files = [];
    const folders = [];
    try {
      // console.log("finding files on path="+path)
      files = fs.readdirSync(filePath).filter((file) => {
        console.log(`found file=${file} on path=${filePath}`);
        if (fs.statSync(`${filePath}/${file}`).isDirectory()) {
          console.log(`${id} saving folder path=${filePath}/${file}`);
          folders.push(`${filePath}/${file}`);
        } else if (!file.startsWith(".")) {
          return file;
        }
      });

      folders.forEach((x) => {
        console.log(`${id} processing for sub folder=${x}`);
        const y = this.getFiles(x, id);
        // console.log("list"+JSON.stringify(y))
        const worklist = [];
        // Get the number of elements in the base path
        const c = this.path_images[id].split("/").length;
        // Get the rest of the path
        const xpath = x.split("/").slice(c).join("/");
        y.forEach((f) => {
          // If the file doesn't have a path
          if (f.includes("/")) {
            // Use it as is

            worklist.push(f);
          } else {
            // Add it

            worklist.push(`${xpath}/${f}`);
          }
        });
        // Add to the files list
        files = files.concat(worklist);
        console.log(`files after concat=${JSON.stringify(files)}`);
      });
    } catch (exception) {
      console.log(
        `getfiles unable to access source folder,path=${filePath} will retry, exception=${JSON.stringify(
          exception
        )}`
      );
    }
    console.log(`${id} returning files=${JSON.stringify(files)}`);

    return files;
  }
});
