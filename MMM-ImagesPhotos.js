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
      "ip-zoom-panright", "ip-zoom-panleft", "ip-zoom-panup", "ip-zoom-pandown",
      "ip-pan-diag-tl-br", "ip-pan-diag-tr-bl", "ip-pan-diag-bl-tr", "ip-pan-diag-br-tl",
      "ip-still",
      "ip-face-zoom"
    ],
    showExif: true,
    language: config.language,
    faceDetection: true
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
  photos: [],
  currentPhoto: null,
  nextPhoto: null,
  lastPhotoIndex: -1,

  requiresVersion: "2.24.0", // Required version of MagicMirror

  start() {
    this.loaded = false;
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
    try {
      const response = await fetch(urlApHelper);
      if (response.ok) {
        this.photos = await response.json();
        this.loaded = true;
        if (this.photos.length > 0) {
          this.prepareNextPhoto(); // Start the process by preparing the first photo
        }
      } else {
        Log.error(this.name, "Could not load photos.");
        this.scheduleUpdate(this.config.retryDelay);
      }
    } catch (error) {
      Log.error(this.name, error);
      this.scheduleUpdate(this.config.retryDelay);
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
  
  socketNotificationReceived(notification, payload) {
    if (notification === "READY" && payload === this.identifier) {
      this.getPhotos();
    }
    if (notification === "METADATA_RESPONSE" && payload.id === this.identifier) {
      if (this.config.debugToConsole) {
        Log.log(`[MMM-ImagesPhotos] METADATA_RESPONSE received for: ${payload.photo.path}`);
      }
      this.nextPhoto = payload.photo;
      if (!this.currentPhoto) {
        // If this is the first photo, display it immediately
        this.updateDom(this.config.animationSpeed);
      }
    }
  },

  prepareNextPhoto() {
    if (this.photos.length === 0) {
      return;
    }
    const nextPhoto = this.randomPhoto();
    if (this.config.debugToConsole) {
      Log.log(`[MMM-ImagesPhotos] prepareNextPhoto: requesting metadata for: ${nextPhoto.path}`);
    }
    this.sendSocketNotification("GET_METADATA", { id: this.identifier, photo: nextPhoto });
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
      // Ensure the next random photo is not the same as the current one
      while (photoIndex === this.lastPhotoIndex) {
        photoIndex = generate();
      }
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
    if (!this.nextPhoto && this.loaded) {
      // Data for the next photo is not ready yet.
      const wrapper = document.createElement("div");
      if(this.config.debugToConsole) {
        wrapper.innerText = "Preparing next photo...";
      }
      return wrapper;
    }
    
    if (!this.nextPhoto && !this.loaded) {
		const wrapper = document.createElement("div");
		wrapper.innerHTML = this.translate("LOADING");
		wrapper.className = "dimmed light small";
		return wrapper;
	}

    // Promote next photo to current and prepare the next one in the background
    this.currentPhoto = JSON.parse(JSON.stringify(this.nextPhoto)); // Deep copy to prevent race conditions
    this.nextPhoto = null;

    if (this.config.debugToConsole) {
      Log.log(`[MMM-ImagesPhotos] getDom: RENDERING CURRENT PHOTO: ${JSON.stringify(this.currentPhoto)}`);
    }
    this.prepareNextPhoto();

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
    const photoImage = this.currentPhoto;

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
      let finalEffect = "";
      let isFaceZoom = false;

      // Decide if we should do a face zoom (30% chance if faces are present)
      if (this.config.faceDetection && this.config.imageEffects.includes("ip-face-zoom") && photoImage.face && photoImage.face.faces && photoImage.face.faces.length > 0) {
        if (Math.random() < 0.4) { // <-- Probability changed to 40%
          isFaceZoom = true;
        }
      }

      
            if (isFaceZoom) {
              const faces = photoImage.face.faces;
              const face = faces[Math.floor(Math.random() * faces.length)]; // Pick a random face
              
              const zoomIn = Math.random() < 0.5;
              if (zoomIn) { // Apply pan-zoom for zoom-in
                const fx_perc = (face.x + face.w / 2) / photoImage.face.width;
                const fy_perc = (face.y + face.h / 2) / photoImage.face.height;
                const S = 1.15; // <-- Scale reverted to 1.15
      
                const fx = fx_perc - 0.5;
                const fy = fy_perc - 0.5;
                const Dx = 0; 
                const Dy = 0.3 - 0.5;
                
                let Tx = (Dx - S * fx) * 100;
                let Ty = (Dy - S * fy) * 100;
      
                // Cap the translation to 15%
                Tx = Math.max(-15, Math.min(15, Tx)); // <-- Capping re-introduced
                Ty = Math.max(-15, Math.min(15, Ty));
                
                const duration = (20 + Math.random() * 20).toFixed(2);
                const keyframeName = `face-pan-zoom-${Date.now()}`;
                const keyframe = `
                  @keyframes ${keyframeName} {
                    0% { transform: translate(0%, 0%) scale(var(--base-scale)); }
                    100% { transform: translate(${Tx}%, ${Ty}%) scale(calc(var(--base-scale) * ${S})); }
                  }
                `;
                
                const styleEl = document.createElement("style");
                styleEl.innerHTML = keyframe;
                document.head.appendChild(styleEl);
      
                img.style.animation = `${keyframeName} ${duration}s ease-in-out both`;
                finalEffect = `ip-face-pan-zoom-in (to 50%, 30%)`;
      
                img.addEventListener("animationend", () => {
                  if(styleEl.parentNode) styleEl.remove();
                }, { once: true });
      
              } else { // Apply simple zoom-out, centered on the face
                const fx_perc = (face.x + face.w / 2) / photoImage.face.width;
                const fy_perc = (face.y + face.h / 2) / photoImage.face.height;
                img.style.transformOrigin = `${fx_perc * 100}% ${fy_perc * 100}%`;
                img.className = "bgimage mmip-bgimage ip-face-zoom-out";
                finalEffect = `ip-face-zoom-out`;
                const randomDuration = (20 + Math.random() * 20).toFixed(2) + 's';
                img.style.animationDuration = randomDuration;
              }
            } else {
              // Fallback to a regular effect
              const regularEffects = this.config.imageEffects.filter(e => e !== 'ip-face-zoom');
              const randomEffect = regularEffects[Math.floor(Math.random() * regularEffects.length)];
              finalEffect = randomEffect;
              img.className = "bgimage mmip-bgimage " + randomEffect;
              const randomDuration = (20 + Math.random() * 20).toFixed(2) + 's';
              img.style.animationDuration = randomDuration;
              finalEffect += ` ${randomDuration}`;
            }
      
            let isLandscape = false;
            if (photoImage.face && photoImage.face.width && photoImage.face.height) {
              isLandscape = photoImage.face.width > photoImage.face.height;
            } else if (photoImage.exif && photoImage.exif.tags && photoImage.exif.tags.ImageWidth && photoImage.exif.tags.ImageHeight) {
              isLandscape = photoImage.exif.tags.ImageWidth > photoImage.exif.tags.ImageHeight;
            } else if (photoImage.exif && photoImage.exif.tags && photoImage.exif.tags.ExifImageWidth && photoImage.exif.tags.ExifImageHeight) {
              isLandscape = photoImage.exif.tags.ExifImageWidth > photoImage.exif.tags.ExifImageHeight;
            }
      
            if (isLandscape) {
              img.classList.add("landscape");
            } else {
              img.classList.add("portrait");
            }
            
            Log.info(`[MMM-ImagesPhotos] Applying effect: ${finalEffect} to ${photoImage.url}`);      photoImage.effect = finalEffect;

      // Attach handlers before src for cached images
      img.onerror = (evt) => {
        Log.error("MMM-ImagesPhotos image load failed", evt && evt.currentTarget && evt.currentTarget.src);
        setTimeout(() => self.updateDom(), self.config.retryDelay);
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
          Log.log(`[MMM-ImagesPhotos] Building EXIF box for ${photoImage.url} with face count: ${photoImage.face ? photoImage.face.count : 'N/A'}`);
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

        if (photoImage.effect) {
          let effectString = `✨ ${photoImage.effect}`;
          if (photoImage.face && photoImage.face.count > 0) {
            effectString += ` (${photoImage.face.count}👤)`;
          }
          infoParts.push(effectString);
        }

        if (infoParts.length > 0) {
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
      const photoImage = this.currentPhoto;
      if (photoImage) {
        // Clear previous image if any
        while (self.fg.firstChild) {
          self.fg.removeChild(self.fg.firstChild);
        }

        const img = document.createElement("img");
        
        // Add random animation effect
        let finalEffect = "";
        let isFaceZoom = false;

        // Decide if we should do a face zoom (30% chance if faces are present)
                if (this.config.faceDetection && this.config.imageEffects.includes("ip-face-zoom") && photoImage.face && photoImage.face.faces && photoImage.face.faces.length > 0) {
                  if (Math.random() < 0.4) { // <-- Probability changed to 40%
                    isFaceZoom = true;
                  }
                }
        
                
                      if (isFaceZoom) {
                        const faces = photoImage.face.faces;
                        const face = faces[Math.floor(Math.random() * faces.length)]; // Pick a random face
                        
                        const zoomIn = Math.random() < 0.5;
                        if (zoomIn) { // Apply pan-zoom for zoom-in
                          const fx_perc = (face.x + face.w / 2) / photoImage.face.width;
                          const fy_perc = (face.y + face.h / 2) / photoImage.face.height;
                          const S = 1.15; // <-- Scale reverted to 1.15
                
                          const fx = fx_perc - 0.5;
                          const fy = fy_perc - 0.5;
                          const Dx = 0; 
                          const Dy = 0.3 - 0.5;
                          
                          let Tx = (Dx - S * fx) * 100;
                          let Ty = (Dy - S * fy) * 100;
                
                          // Cap the translation to 15%
                          Tx = Math.max(-15, Math.min(15, Tx)); // <-- Capping re-introduced
                          Ty = Math.max(-15, Math.min(15, Ty));
                          
                          const duration = (20 + Math.random() * 20).toFixed(2);
                          const keyframeName = `face-pan-zoom-${Date.now()}`;
                          const keyframe = `
                            @keyframes ${keyframeName} {
                              0% { transform: translate(0%, 0%) scale(var(--base-scale)); }
                              100% { transform: translate(${Tx}%, ${Ty}%) scale(calc(var(--base-scale) * ${S})); }
                            }
                          `;
                          
                          const styleEl = document.createElement("style");
                          styleEl.innerHTML = keyframe;
                          document.head.appendChild(styleEl);
                
                          img.style.animation = `${keyframeName} ${duration}s ease-in-out both`;
                          finalEffect = `ip-face-pan-zoom-in (to 50%, 30%)`;
                
                          img.addEventListener("animationend", () => {
                            if(styleEl.parentNode) styleEl.remove();
                          }, { once: true });
                
                        } else { // Apply simple zoom-out, centered on the face
                          const fx_perc = (face.x + face.w / 2) / photoImage.face.width;
                          const fy_perc = (face.y + face.h / 2) / photoImage.face.height;
                          img.style.transformOrigin = `${fx_perc * 100}% ${fy_perc * 100}%`;
                          img.className = "bgimage mmip-bgimage ip-face-zoom-out";
                          finalEffect = `ip-face-zoom-out`;
                          const randomDuration = (20 + Math.random() * 20).toFixed(2) + 's';
                          img.style.animationDuration = randomDuration;
                        }
                      } else {
                        // Fallback to a regular effect
                        const regularEffects = this.config.imageEffects.filter(e => e !== 'ip-face-zoom');
                        const randomEffect = regularEffects[Math.floor(Math.random() * regularEffects.length)];
                        finalEffect = randomEffect;
                        img.className = "bgimage mmip-bgimage " + randomEffect;
                        const randomDuration = (20 + Math.random() * 20).toFixed(2) + 's';
                        img.style.animationDuration = randomDuration;
                        finalEffect += ` ${randomDuration}`;
                      }
                
                      let isLandscape = false;
                      if (photoImage.face && photoImage.face.width && photoImage.face.height) {
                        isLandscape = photoImage.face.width > photoImage.face.height;
                      } else if (photoImage.exif && photoImage.exif.tags && photoImage.exif.tags.ImageWidth && photoImage.exif.tags.ImageHeight) {
                        isLandscape = photoImage.exif.tags.ImageWidth > photoImage.exif.tags.ImageHeight;
                      } else if (photoImage.exif && photoImage.exif.tags && photoImage.exif.tags.ExifImageWidth && photoImage.exif.tags.ExifImageHeight) {
                        isLandscape = photoImage.exif.tags.ExifImageWidth > photoImage.exif.tags.ExifImageHeight;
                      }
                
                      if (isLandscape) {
                        img.classList.add("landscape");
                      } else {
                        img.classList.add("portrait");
                      }
                      
                      Log.info(`[MMM-ImagesPhotos] Applying effect: ${finalEffect} to ${photoImage.url}`);        photoImage.effect = finalEffect;

        img.style.position = "absolute";
        // Image is always visible within its container, we fade the container
        img.style.opacity = self.config.opacity;
        
        img.onerror = (evt) => {
          Log.error("MMM-ImagesPhotos image load failed", evt && evt.currentTarget && evt.currentTarget.src);
          setTimeout(() => this.updateDom(), this.config.retryDelay);
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
            Log.log(`[MMM-ImagesPhotos] Building EXIF box for ${photoImage.url} with face count: ${photoImage.face ? photoImage.face.count : 'N/A'}`);
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

          if (photoImage.effect) {
            let effectString = `✨ ${photoImage.effect}`;
            if (photoImage.face && photoImage.face.count > 0) {
              effectString += ` (${photoImage.face.count}👤)`;
            }
            infoParts.push(effectString);
          }

          if (infoParts.length > 0) {
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