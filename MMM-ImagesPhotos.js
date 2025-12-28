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
  startTimer() {
    const self = this;
    self.timer = setTimeout(() => {
      // Clear timer value for resume
      self.timer = null;
      if (self.suspended === false) {
        self.updateDom(self.config.animationSpeed);
      }
    }, this.config.updateInterval);
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
      Log.log(this.name, `computeAverageColor: src=${imageEl && imageEl.src}`);
      try { if (this.config && this.config.debugToConsole) console.log(this.name + ": computeAverageColor: src=" + (imageEl && imageEl.src)); } catch (e) {}
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
        Log.warn(this.name, "computeAverageColor: no pixels sampled");
        try { if (this.config && this.config.debugToConsole) console.warn(this.name + ": computeAverageColor: no pixels sampled"); } catch (e) {}
        return null;
      }
      r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
      const rgb = `rgb(${r}, ${g}, ${b})`;
      Log.log(this.name, `computeAverageColor: result=${rgb}`);
      try { if (this.config && this.config.debugToConsole) console.log(this.name + ": computeAverageColor: result=" + rgb); } catch (e) {}
      return rgb;
    } catch (e) {
      Log.warn(this.name, "computeAverageColor failed", e);
      try { if (this.config && this.config.debugToConsole) console.warn(this.name + ": computeAverageColor failed", e); } catch (ee) {}
      return null;
    }
  },

  animateTransition(imgEl, container) {
    const self = this;
    const cfg = self.config || {};
    const defs = self.transitionDefaults || {};
    const blackDuration = cfg.blackDuration || defs.blackDuration;
    const fadeDuration = cfg.fadeDuration || defs.fadeDuration;
    const displayDuration = cfg.displayDuration || defs.displayDuration;
    const easing = cfg.transitionEasing || defs.easing;

    // ensure starting state
    try { imgEl.style.opacity = 0; } catch (e) {}
    try { if (container) { container.style.backgroundColor = "black"; } } catch (e) {}
    // prepare background-color transition so changes animate smoothly
    try { if (container) { container.style.transition = `background-color ${fadeDuration}ms ${easing}`; } } catch (e) {}
    Log.log(this.name, `animateTransition: black=${blackDuration} fade=${fadeDuration} display=${displayDuration} easing=${easing} container=${!!container}`);
    try { if (this.config && this.config.debugToConsole) console.log(this.name + `: animateTransition: black=${blackDuration} fade=${fadeDuration} display=${displayDuration} easing=${easing} container=${!!container}`); } catch (e) {}

    // compute average color (may fail on cross-origin)
    let avg = null;
    try { avg = self.computeAverageColor(imgEl); } catch (e) { avg = null; }
    Log.log(this.name, `animateTransition: computed avg=${avg}`);
    try { if (this.config && this.config.debugToConsole) console.log(this.name + `: animateTransition: computed avg=${avg}`); } catch (e) {}

    // after blackDuration -> set bg to avg and fade in
    setTimeout(() => {
      try {
        if (avg && container) {
          Log.log(this.name, `animateTransition: setting container background to ${avg}`);
          try { if (this.config && this.config.debugToConsole) console.log(this.name + `: animateTransition: setting container background to ${avg}`); } catch (e) {}
          container.style.backgroundColor = avg;
        } else if (!avg) {
          Log.warn(this.name, "animateTransition: avg color null; leaving black background");
          try { if (this.config && this.config.debugToConsole) console.warn(this.name + ": animateTransition: avg color null; leaving black background"); } catch (e) {}
        }
      } catch (e) { Log.warn(this.name, "animateTransition: error setting background", e); }
      try { imgEl.style.transition = `opacity ${fadeDuration}ms ${easing}`; imgEl.style.opacity = self.config.opacity; } catch (e) { Log.warn(this.name, "animateTransition: error fading in", e); }
    }, blackDuration);

    // schedule fade-out to black after black+fade+display
    setTimeout(() => {
      Log.log(this.name, `animateTransition: starting fade-out to black`);
      try { if (this.config && this.config.debugToConsole) console.log(this.name + ": animateTransition: starting fade-out to black"); } catch (e) {}
      try { imgEl.style.transition = `opacity ${fadeDuration}ms ${easing}`; imgEl.style.opacity = 0; } catch (e) { Log.warn(this.name, "animateTransition: error fading out", e); }
      try { if (container) { container.style.transition = `background-color ${fadeDuration}ms ${easing}`; container.style.backgroundColor = "black"; } } catch (e) { Log.warn(this.name, "animateTransition: error resetting background", e); }
    }, blackDuration + fadeDuration + displayDuration);
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
    if (this.timer === null) {
      this.startTimer();
    }
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
      const img = document.createElement("img");
      img.id = "mmm-images-photos";
      img.style.maxWidth = this.config.maxWidth;
      img.style.maxHeight = this.config.maxHeight;
      img.style.opacity = 0; // start invisible
      img.className = "bgimage mmip-bgimage";
      // attach handlers before src for cached images
      img.onerror = (evt) => {
        Log.error("MMM-ImagesPhotos image load failed", evt && evt.currentTarget && evt.currentTarget.src);
        self.updateDom();
      };
      img.onload = (evt) => {
        try { self.animateTransition(evt.currentTarget, wrapper); } catch (e) { Log.warn(self.name, e); }
      };
      // attempt to allow canvas readback for cross-origin images (requires server CORS)
      try { img.crossOrigin = 'Anonymous'; } catch (e) {}
      img.src = photoImage.url;
      wrapper.appendChild(img);
      self.startTimer();
    }
    return wrapper;
  },

  getDomFS() {
    const self = this;
    // If wrapper div not yet created
    if (this.wrapper === null) {
      // Create it once, try to reduce image flash on change

      this.wrapper = document.createElement("div");
      this.bk = document.createElement("div");
      this.bk.className = "bgimagefs";
      if (this.config.fill === true) {
        this.bk.style.filter = `blur(${this.config.blur}px)`;
        this.bk.style["-webkit-filter"] = `blur(${this.config.blur}px)`;
      } else {
        this.bk.style.backgroundColor = this.config.backgroundColor;
      }
      this.wrapper.appendChild(this.bk);
      this.fg = document.createElement("div");
      this.fg.className = "mmip-foreground";
      this.wrapper.appendChild(this.fg);
    }
    if (this.photos.length) {
      // Get the size of the margin, if any, we want to be full screen
      const m = window
        .getComputedStyle(document.body, null)
        .getPropertyValue("margin-top");
      // Set the style for the containing div

      this.fg.style.border = "none";
      this.fg.style.margin = "0px";

      const photoImage = this.randomPhoto();
      let img = null;
      if (photoImage) {
        // Create img tag element
        img = document.createElement("img");

        // Set default position, corrected in onload handler
        img.style.left = `0px`;
        img.style.top = `0px`;
        img.style.position = "absolute";
        img.style.zIndex = 2;

        img.style.opacity = 0; // start invisible
        // attach handlers before src
        img.className = "bgimage mmip-bgimage";
        img.onerror = (evt) => {
          const eventImage = evt.currentTarget;
          Log.error(`image load failed=${eventImage.src}`);
          this.updateDom();
        };
        img.onload = (evt) => {
          const eventImage = evt.currentTarget;
          Log.log(`image loaded=${eventImage.src} size=${eventImage.width}:${eventImage.height}`);

          // What's the size of this image and it's parent
          const w = eventImage.width;
          const h = eventImage.height;
          const tw = document.body.clientWidth + parseInt(m, 10) * 2;
          const th = document.body.clientHeight + parseInt(m, 10) * 2;

          // Compute the new size and offsets
          const result = self.scaleImage(w, h, tw, th, true);

          // Adjust the image size
          eventImage.width = result.width;
          eventImage.height = result.height;

          Log.log(`image setting size to ${result.width}:${result.height}`);
          Log.log(
            `image setting top to ${result.targetleft}:${result.targettop}`
          );

          // Adjust the image position
          eventImage.style.left = `${result.targetleft}px`;
          eventImage.style.top = `${result.targettop}px`;

          // use animateTransition with background element
          try { self.animateTransition(eventImage, self.bk); } catch (e) { Log.warn(self.name, e); }

          // If another image was already displayed, remove older ones
          const c = self.fg.childElementCount;
          if (c > 1) {
            for (let i = 0; i < c - 1; i++) {
              const child = self.fg.firstChild;
              if (child) {
                child.style.opacity = 0;
                child.style.backgroundColor = "rgba(0,0,0,0)";
                self.fg.removeChild(child);
              }
            }
          }
          if (self.fg.firstChild) {
            self.fg.firstChild.style.opacity = self.config.opacity;
            self.fg.firstChild.style.transition = "opacity 1.25s";
            if (self.config.fill === true) {
              self.bk.style.backgroundImage = `url(${self.fg.firstChild.src})`;
            }
          }
          self.startTimer();
        };
        // attempt to allow canvas readback for cross-origin images (requires server CORS)
        try { img.crossOrigin = 'Anonymous'; } catch (e) {}
        // set src last
        img.src = photoImage.url;
        // Append this image to the div
        this.fg.appendChild(img);

        /* set the image load error handler
           report the image load failed
           go load the next one with no delay
        */   
        img.onerror = (evt) => {
          const eventImage = evt.currentTarget;
          Log.error(
            `image load failed=${eventImage.src}`
          );
          this.updateDom()
        }
        /*
         * Set the onload event handler
         * The loadurl request will happen when the html is returned to MM and inserted into the dom.
         */
        img.onload = (evt) => {
          // Get the image of the event
          const eventImage = evt.currentTarget;
          Log.log(
            `image loaded=${eventImage.src} size=${eventImage.width}:${eventImage.height}`
          );

          // What's the size of this image and it's parent
          const w = eventImage.width;
          const h = eventImage.height;
          const tw = document.body.clientWidth + parseInt(m, 10) * 2;
          const th = document.body.clientHeight + parseInt(m, 10) * 2;

          // Compute the new size and offsets
          const result = self.scaleImage(w, h, tw, th, true);

          // Adjust the image size
          eventImage.width = result.width;
          eventImage.height = result.height;

          Log.log(`image setting size to ${result.width}:${result.height}`);
          Log.log(
            `image setting top to ${result.targetleft}:${result.targettop}`
          );

          // Adjust the image position
          eventImage.style.left = `${result.targetleft}px`;
          eventImage.style.top = `${result.targettop}px`;

          // If another image was already displayed
          const c = self.fg.childElementCount;
          if (c > 1) {
            for (let i = 0; i < c - 1; i++) {
              // Hide it
              self.fg.firstChild.style.opacity = 0;
              self.fg.firstChild.style.backgroundColor = "rgba(0,0,0,0)";
              // Remove the image element from the div
              self.fg.removeChild(self.fg.firstChild);
            }
          }
          self.fg.firstChild.style.opacity = self.config.opacity;

          self.fg.firstChild.style.transition = "opacity 1.25s";
          if (self.config.fill === true) {
            self.bk.style.backgroundImage = `url(${self.fg.firstChild.src})`;
          }
          self.startTimer();
        };
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
