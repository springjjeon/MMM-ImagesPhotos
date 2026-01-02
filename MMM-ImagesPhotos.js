/* global Log MM Module */

/*
 * MagicMirror²
 * Module: MMM-ImagesPhotos
 *
 * By Rodrigo Ramírez Norambuena https://rodrigoramirez.com
 * MIT Licensed.
 */
const ourModuleName = "MMM-ImagesPhotos";

Module.register(ourModuleName, {
  defaults: {
    opacity: 0.9,
    animationSpeed: 500,
    updateInterval: 5000,
    getInterval: 60000,
    maxWidth: "100%",
    maxHeight: "100%",
    retryDelay: 2500,
    path: "",
    fill: false,
    blur: 8,
    sequential: false
    ,debugToConsole: true
    ,imageEffects: [
      "ip-zoom", "ip-panright", "ip-panleft", "ip-panup", "ip-pandown", 
      "ip-zoom-panright", "ip-zoom-panleft", "ip-zoom-panup", "ip-zoom-pandown"
    ],
    showExif: true,
    language: config.language
  },
  // transition defaults (ms)
  transitionDefaults: {
    blackDuration: 1000,
    fadeDuration: 1000,
    displayDuration: 5000,
    easing: "ease-in-out"
  },

  wrapper: null,
  suspended: false,
  timer: null,
  fullscreen: false,

  requiresVersion: "2.24.0", // Required version of MagicMirror

  start() {
    this.photos = [];
    this.loaded = false;
    this.lastPhotoIndex = -1;
    this.config.id = this.identifier;
    this.sendSocketNotification("CONFIG", this.config);
    // Explicit startup log for terminal visibility
    try { Log.info(`${this.name}: start()`); } catch (e) {}
    try { if (this.config && this.config.debugToConsole) console.log(`${this.name}: start()`); } catch (e) {}
  },
  getStyles() {
    return ["MMM-ImagesPhotos.css"];
  },

  /*
   * Requests new data from api url helper
   */
  async getPhotos() {
    const urlApHelper = `/MMM-ImagesPhotos/photos/${this.identifier}`;
    const self = this;
    let retry = true;

    try {
      const photosResponse = await fetch(urlApHelper);

      if (photosResponse.ok) {
        const photosData = await photosResponse.json();
        self.processPhotos(photosData);
      } else if (photosResponse.status === 401) {
        self.updateDom(self.config.animationSpeed);
        Log.error(self.name, photosResponse.status);
        retry = false;
      } else {
        Log.error(self.name, "Could not load photos.");
      }

      if (!photosResponse.ok) {
        if (retry) {
          self.scheduleUpdate(self.loaded ? -1 : self.config.retryDelay);
        }
      }
    } catch (error) {
      Log.error(self.name, error);
    }
  },
  notificationReceived(notification, payload, sender) {
    // Hook to turn off messages about notiofications, clock once a second
    if (notification === "ALL_MODULES_STARTED") {
      const ourInstances = MM.getModules().withClass(ourModuleName);
      ourInstances.forEach((m) => {
        if (m.data.position.toLowerCase().startsWith("fullscreen")) {
          this.fullscreen = true;
        }
      });
    }
  },
  
  socketNotificationReceived(notification, payload, source) {
    if (notification === "READY" && payload === this.identifier) {
      // Schedule update timer.
      this.getPhotos();
    }
  },

  /*
   * Schedule next update.
   *
   * argument delay number - Milliseconds before next update.
   *  If empty, this.config.updateInterval is used.
   */
  scheduleUpdate(delay) {
    let nextLoad = this.config.getInterval;
    if (typeof delay !== "undefined" && delay >= 0) {
      nextLoad = delay;
    }

    const self = this;
    setTimeout(() => {
      self.getPhotos();
    }, nextLoad);
  },

  /*
   * Generate a random index for a list of photos.
   *
   * argument photos Array<String> - Array with photos.
   *
   * return Number - Random index.
   */
  randomIndex(photos) {
    if (photos.length === 1) {
      return 0;
    }

    const generate = () => Math.floor(Math.random() * photos.length);

    let photoIndex =
      this.lastPhotoIndex === photos.length - 1 ? 0 : this.lastPhotoIndex + 1;
    if (!this.config.sequential) {
      photoIndex = generate();
    }
    this.lastPhotoIndex = photoIndex;

    return photoIndex;
  },

  /*
   * Retrieve a random photos.
   *
   * return photo Object - A photo.
   */
  randomPhoto() {
    const { photos } = this;
    const index = this.randomIndex(photos);

    return photos[index];
  },

  scaleImage(srcwidth, srcheight, targetwidth, targetheight, fLetterBox) {
    const result = { width: 0, height: 0, fScaleToTargetWidth: true };

    if (
      srcwidth <= 0 ||
      srcheight <= 0 ||
      targetwidth <= 0 ||
      targetheight <= 0
    ) {
      return result;
    }

    // Scale to the target width
    const scaleX1 = targetwidth;
    const scaleY1 = (srcheight * targetwidth) / srcwidth;

    // Scale to the target height
    const scaleX2 = (srcwidth * targetheight) / srcheight;
    const scaleY2 = targetheight;

    // Now figure out which one we should use
    let fScaleOnWidth = scaleX2 > targetwidth;
    if (fScaleOnWidth) {
      fScaleOnWidth = fLetterBox;
    } else {
      fScaleOnWidth = !fLetterBox;
    }

    if (fScaleOnWidth) {
      result.width = Math.floor(scaleX1);
      result.height = Math.floor(scaleY1);
      result.fScaleToTargetWidth = true;
    } else {
      result.width = Math.floor(scaleX2);
      result.height = Math.floor(scaleY2);
      result.fScaleToTargetWidth = false;
    }
    result.targetleft = Math.floor((targetwidth - result.width) / 2);
    result.targettop = Math.floor((targetheight - result.height) / 2);

    return result;
  },

  computeAverageColor(imageEl) {
    try {
      if (this.config.debugToConsole) Log.log(`${this.name}: computeAverageColor: src=${imageEl && imageEl.src}`);
      const sampleSize = 40;
      const canvas = document.createElement("canvas");
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imageEl, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let r = 0, g = 0, b = 0, count = 0;
      const stride = 4 * 3;
      for (let i = 0; i < data.length; i += stride) {
        r += data[i]; g += data[i+1]; b += data[i+2]; count++;
      }
      if (count === 0) {
        if (this.config.debugToConsole) Log.warn(this.name, "computeAverageColor: no pixels sampled");
        return null;
      }
      r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
      const rgb = `rgb(${r}, ${g}, ${b})`;
      if (this.config.debugToConsole) Log.log(`${this.name}: computeAverageColor: result=${rgb}`);
      return rgb;
    } catch (e) {
      Log.warn(this.name, "computeAverageColor failed", e);
      return null;
    }
  },

  animateTransition(imgEl, container) {
    const self = this;
    const cfg = self.config || {};
    const defs = self.transitionDefaults || {};
    
    // Use updateInterval for display duration, falling back to transition default
    const displayDuration = cfg.updateInterval || defs.displayDuration;
    const blackDuration = cfg.blackDuration || defs.blackDuration;
    const fadeDuration = cfg.fadeDuration || defs.fadeDuration;
    const easing = cfg.transitionEasing || defs.easing;

    // The foreground container holds the image. This is what we will fade.
    const fgContainer = imgEl.parentElement;
    // In non-FS mode, the main container is the wrapper. In FS mode, it's this.bk.
    const mainContainer = self.fullscreen ? self.bk : container;
    
    // Ensure the main background is black.
    if (mainContainer) {
      mainContainer.style.backgroundColor = "black";
    }

    if (self.config.debugToConsole) Log.log(`${this.name}: animateTransition: black=${blackDuration} fade=${fadeDuration} display=${displayDuration} easing=${easing}`);

    // Schedule next update after this animation completes
    if (self.timer) clearTimeout(self.timer);
    const nextUpdateDelay = blackDuration + fadeDuration + displayDuration + fadeDuration;
    self.timer = setTimeout(() => {
      self.updateDom(self.config.animationSpeed);
    }, nextUpdateDelay);
    
    // Compute average color and apply it to the foreground container
    const avg = self.computeAverageColor(imgEl);
    if (self.config.debugToConsole) Log.log(`${this.name}: animateTransition: computed avg=${avg}`);
    
    if (fgContainer) {
      fgContainer.style.backgroundColor = avg || "black";
      fgContainer.style.transition = `opacity ${fadeDuration}ms ${easing}`;
      
      // After blackDuration, fade IN the foreground container
      setTimeout(() => {
        if (self.config.debugToConsole) Log.log(`${this.name}: animateTransition: fading in`);
        fgContainer.style.opacity = 1;
      }, blackDuration);

      // After display duration, fade OUT the foreground container
      setTimeout(() => {
        if (self.config.debugToConsole) Log.log(`${this.name}: animateTransition: starting fade-out`);
        fgContainer.style.opacity = 0;
      }, blackDuration + fadeDuration + displayDuration);
    }
  },

  suspend() {
    this.suspended = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },
  resume() {
    this.suspended = false;
    // On resume, immediately update to the next image.
    this.updateDom(this.config.animationSpeed);
  },

  getDom() {
    if (this.fullscreen) {
      return this.getDomFS();
    }
    return this.getDomnotFS();
  },

  getDomnotFS() {
    const self = this;
    const wrapper = document.createElement("div");
    // Ensure the wrapper has sizing and a background so color transitions are visible
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.overflow = "hidden";
    wrapper.style.backgroundColor = "black";
    
    const photoImage = this.randomPhoto();

    if (photoImage) {
      // Create a foreground container for the image, this is what will be faded
      const fg = document.createElement("div");
      fg.className = "mmip-foreground";
      fg.style.opacity = 0; // start invisible
      wrapper.appendChild(fg);

      const img = document.createElement("img");
      img.id = "mmm-images-photos";
      img.style.maxWidth = this.config.maxWidth;
      img.style.maxHeight = this.config.maxHeight;
      // Image is always visible within its container, we fade the container
      img.style.opacity = this.config.opacity;
      
      // Add random animation effect
      const effects = this.config.imageEffects;
      const randomEffect = effects[Math.floor(Math.random() * effects.length)];
      img.className = "bgimage mmip-bgimage " + randomEffect;

      // Attach handlers before src for cached images
      img.onerror = (evt) => {
        Log.error("MMM-ImagesPhotos image load failed", evt && evt.currentTarget && evt.currentTarget.src);
        self.updateDom();
      };
      img.onload = (evt) => {
        try { self.animateTransition(evt.currentTarget, wrapper); } catch (e) { Log.warn(self.name, e); }
      };

      // Attempt to allow canvas readback for cross-origin images (requires server CORS)
      try { img.crossOrigin = 'Anonymous'; } catch (e) {}
      
      fg.appendChild(img);
      img.src = photoImage.url;

      if (this.config.showExif && photoImage.exif && photoImage.exif.tags) {
        if (this.config.debugToConsole) {
          Log.log(`[MMM-ImagesPhotos] Photo location for getDomnotFS: ${photoImage.location}`);
        }
        const exifWrapper = document.createElement("div");
        exifWrapper.className = "exif-info";

        const infoParts = [];

        const timestamp = photoImage.exif.tags.DateTimeOriginal;
        if (timestamp && typeof timestamp === 'number') {
          const dateObj = new Date(timestamp * 1000);
          const year = dateObj.getUTCFullYear();
          const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
          const day = String(dateObj.getUTCDate()).padStart(2, '0');
          const hour = String(dateObj.getUTCHours()).padStart(2, '0');
          const minute = String(dateObj.getUTCMinutes()).padStart(2, '0');
          infoParts.push(`🗓️ ${year}-${month}-${day} ${hour}:${minute}`);
        }

        if (photoImage.location) {
            infoParts.push(`📍 ${photoImage.location}`);
        }

        if (photoImage.exif.tags.Model) {
            infoParts.push(`📷 ${photoImage.exif.tags.Model}`);
        }

        const photoParamParts = [];
        const tags = photoImage.exif.tags;

        if (tags.FocalLength) {
            photoParamParts.push(`${tags.FocalLength}mm`);
        }
        if (tags.FNumber) {
            photoParamParts.push(`f/${tags.FNumber.toFixed(1)}`);
        }
        if (tags.ExposureTime) {
            const exposureTime = tags.ExposureTime;
            if (exposureTime < 1) {
                photoParamParts.push(`1/${Math.round(1 / exposureTime)}s`);
            } else {
                photoParamParts.push(`${exposureTime}s`);
            }
        }
        if (tags.ISO) {
            photoParamParts.push(`ISO ${tags.ISO}`);
        }

        if (photoParamParts.length > 0) {
            infoParts.push(`⚙️ ${photoParamParts.join(' ')}`);
        }

        if (infoParts.length > 0) {
            exifWrapper.style.position = "absolute";
            exifWrapper.style.bottom = "10px";
            exifWrapper.style.right = "10px";
            exifWrapper.style.color = "white";
            exifWrapper.style.backgroundColor = "rgba(0,0,0,0.5)";
            exifWrapper.style.padding = "5px";
            exifWrapper.style.borderRadius = "10px";
            exifWrapper.style.zIndex = "3";
            exifWrapper.innerHTML = infoParts.join('<br>');
            fg.appendChild(exifWrapper);
        }
      }
    }
    return wrapper;
  },

  getDomFS() {
    const self = this;
    // If wrapper div not yet created, create it once
    if (this.wrapper === null) {
      this.wrapper = document.createElement("div");
      // Background element
      this.bk = document.createElement("div");
      this.bk.className = "bgimagefs";
      this.wrapper.appendChild(this.bk);
      // Foreground element (for image and avg color)
      this.fg = document.createElement("div");
      this.fg.className = "mmip-foreground";
      this.wrapper.appendChild(this.fg);
    }
    
    // Set background style based on config
    if (this.config.fill === true) {
      this.bk.style.filter = `blur(${this.config.blur}px)`;
      this.bk.style["-webkit-filter"] = `blur(${this.config.blur}px)`;
    } else {
      this.bk.style.backgroundColor = "black";
    }

    if (this.photos.length) {
      const photoImage = this.randomPhoto();
      if (photoImage) {
        // Clear previous image if any
        while (self.fg.firstChild) {
          self.fg.removeChild(self.fg.firstChild);
        }

        const img = document.createElement("img");
        
        // Add random animation effect
        const effects = this.config.imageEffects;
        const randomEffect = effects[Math.floor(Math.random() * effects.length)];
        img.className = "bgimage mmip-bgimage " + randomEffect;

        img.style.position = "absolute";
        // Image is always visible within its container, we fade the container
        img.style.opacity = self.config.opacity;
        
        img.onerror = (evt) => {
          Log.error("MMM-ImagesPhotos image load failed", evt && evt.currentTarget && evt.currentTarget.src);
          this.updateDom();
        };

        img.onload = (evt) => {
          const eventImage = evt.currentTarget;
          const m = window.getComputedStyle(document.body, null).getPropertyValue("margin-top");
          const w = eventImage.width;
          const h = eventImage.height;
          const tw = document.body.clientWidth + parseInt(m, 10) * 2;
          const th = document.body.clientHeight + parseInt(m, 10) * 2;
          const result = self.scaleImage(w, h, tw, th, true);

          eventImage.width = result.width;
          eventImage.height = result.height;
          eventImage.style.left = `${result.targetleft}px`;
          eventImage.style.top = `${result.targettop}px`;

          if (self.config.fill === true) {
            self.bk.style.backgroundImage = `url(${eventImage.src})`;
          }
          
          try { self.animateTransition(eventImage, self.bk); } catch (e) { Log.warn(self.name, e); }
        };

        try { img.crossOrigin = 'Anonymous'; } catch (e) {}
        
        img.src = photoImage.url;
        this.fg.appendChild(img);

        if (this.config.showExif && photoImage.exif && photoImage.exif.tags) {
          if (this.config.debugToConsole) {
            Log.log(`[MMM-ImagesPhotos] Photo location for getDomFS: ${photoImage.location}`);
          }
          const exifWrapper = document.createElement("div");
          exifWrapper.className = "exif-info";

          const infoParts = [];

          const timestamp = photoImage.exif.tags.DateTimeOriginal;
          if (timestamp && typeof timestamp === 'number') {
            const dateObj = new Date(timestamp * 1000);
            const year = dateObj.getUTCFullYear();
            const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getUTCDate()).padStart(2, '0');
            const hour = String(dateObj.getUTCHours()).padStart(2, '0');
            const minute = String(dateObj.getUTCMinutes()).padStart(2, '0');
            infoParts.push(`🗓️ ${year}-${month}-${day} ${hour}:${minute}`);
          }

          if (photoImage.location) {
              infoParts.push(`📍 ${photoImage.location}`);
          }

          if (photoImage.exif.tags.Model) {
              infoParts.push(`📷 ${photoImage.exif.tags.Model}`);
          }

          const photoParamParts = [];
          const tags = photoImage.exif.tags;

          if (tags.FocalLength) {
              photoParamParts.push(`${tags.FocalLength}mm`);
          }
          if (tags.FNumber) {
              photoParamParts.push(`f/${tags.FNumber.toFixed(1)}`);
          }
          if (tags.ExposureTime) {
              const exposureTime = tags.ExposureTime;
              if (exposureTime < 1) {
                  photoParamParts.push(`1/${Math.round(1 / exposureTime)}s`);
              } else {
                  photoParamParts.push(`${exposureTime}s`);
              }
          }
          if (tags.ISO) {
              photoParamParts.push(`ISO ${tags.ISO}`);
          }

          if (photoParamParts.length > 0) {
              infoParts.push(`⚙️ ${photoParamParts.join(' ')}`);
          }

          if (infoParts.length > 0) {
              exifWrapper.style.position = "absolute";
              exifWrapper.style.bottom = "10px";
              exifWrapper.style.right = "10px";
              exifWrapper.style.color = "white";
                          exifWrapper.style.backgroundColor = "rgba(0,0,0,0.5)";
                          exifWrapper.style.padding = "5px";
                          exifWrapper.style.borderRadius = "10px";
                          exifWrapper.style.zIndex = "3";
                          exifWrapper.innerHTML = infoParts.join('<br>');
                          this.fg.appendChild(exifWrapper);          }
        }
      }
    }
    return this.wrapper;
  },

  getScripts() {
    return ["MMM-ImagesPhotos.css"];
  },

  processPhotos(data) {
    const self = this;
    this.photos = data;
    if (this.loaded === false) {
      if (this.suspended === false) {
        self.updateDom(self.config.animationSpeed);
      }
    }
    this.loaded = true;
  }
});
