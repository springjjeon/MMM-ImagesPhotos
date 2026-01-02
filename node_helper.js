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
  socketNotificationReceived(notification, payload) {
    if (notification === "CONFIG") {
      console.log(`Config based debug=${payload.id}`);
      this.config[payload.id] = payload;
      this.setConfig(payload.id);
      this.extraRoutes(payload.id);
      this.sendSocketNotification("READY", payload.id);
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
  async getPhotosImages(req, res, id) {
    console.log(`gpi id=${id}`);
    const directoryImages = this.path_images[id];

    const imgs = this.getFiles(directoryImages, id);
    const imagePromises = this.getImages(imgs, id).map(async (img) => {
      console.log(`${id} have image=${img}`);
      const imagePath = path.join(directoryImages, img);
      const photoObject = {
        url: `/MMM-ImagesPhotos/photo/${id}/${img}`,
        exif: null,
        location: null
      };

      // Only process EXIF and GPS if showExif is enabled
      if (this.config[id].showExif) {
        try {
          const fileBuffer = fs.readFileSync(imagePath);
          const parser = exifParser.create(fileBuffer);
          photoObject.exif = parser.parse();
          if (photoObject.exif && photoObject.exif.tags && photoObject.exif.tags.GPSLatitude) {
            console.log(`[MMM-ImagesPhotos] GPS data found for ${img}.`);
          } else {
            console.log(`[MMM-ImagesPhotos] No GPS data for ${img}.`);
          }
        } catch (error) {
          console.error(`Could not parse EXIF for ${img}:`, error.message);
        }
        
        if (photoObject.exif && photoObject.exif.tags && photoObject.exif.tags.GPSLatitude && photoObject.exif.tags.GPSLongitude) {
          try {
            const locationData = await reverseGeocode(photoObject.exif.tags.GPSLatitude, photoObject.exif.tags.GPSLongitude, this.config[id].language);

            if (locationData && locationData.address) {
              photoObject.location = this.buildLocationString(locationData.address, locationData.display_name);
              console.log(`[MMM-ImagesPhotos] Constructed location for ${img}:`, photoObject.location);
            }
          } catch (e) {
            console.error(`Could not reverse geocode for ${img}:`, e.message);
          }
        }
      }

      return photoObject;
    });
    
    try {
      const imagesPhotos = await Promise.all(imagePromises);
      res.send(imagesPhotos);
    } catch(e) {
      console.error(`Error processing images:`, e);
      res.status(500).send([]);
    }
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
