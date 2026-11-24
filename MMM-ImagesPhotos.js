/* global Log MM Module config */

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
    sequential: false,
    debugToConsole: true,
    enableVideoPlayback: true,
    videoPlaybackMultiplier: 1.2,
    transitionMode: "black", // "black" | "crossfade"
    enablePortraitCollage: true,
    collageProbability: 0.5,
    stillProbability: 0.25,
    seasonalWeight: 5,
    imageEffects: [
      "ip-zoom", "ip-panright", "ip-panleft", "ip-panup", "ip-pandown",
      "ip-zoom-panright", "ip-zoom-panleft", "ip-zoom-panup", "ip-zoom-pandown",
      "ip-pan-diag-tl-br", "ip-pan-diag-tr-bl", "ip-pan-diag-bl-tr", "ip-pan-diag-br-tl",
      "ip-still",
      "ip-face-zoom"
    ],
    showExif: true,
    language: config.language,
    faceDetection: true,
    showUploadQrCode: true,
    uploadUrl: "",
    uploadPort: 8999,
    qrCodePosition: "bottom-left"
  },

  transitionDefaults: {
    blackDuration: 1000,
    fadeDuration: 1500,
    displayDuration: 5000,
    easing: "ease-in-out"
  },

  wrapper: null,
  bk: null,
  fg: null,
  fgLayers: null,
  activeLayerIdx: 0,
  overlayRoot: null,
  qrRendered: false,
  pauseBadgeEl: null,
  suspended: false,
  paused: false,
  galleryMode: false,
  filterMode: "all",
  filterFolder: "",
  timer: null,
  fadeTimers: [],
  fullscreen: false,
  photos: [],
  photoDeck: [],
  photoHistory: [],
  goingBack: false,
  currentPhoto: null,
  nextPhoto: null,
  lastPhotoIndex: -1,
  lastDrawnPath: null,
  serverIp: null,

  requiresVersion: "2.24.0",

  start() {
    this.loaded = false;
    this.paused = false;
    this.fadeTimers = [];
    this.photoDeck = [];
    this.photoHistory = [];
    this.goingBack = false;
    this.config.id = this.identifier;
    this.sendSocketNotification("CONFIG", this.config);
    try { Log.info(`${this.name}: start()`); } catch (e) {}
  },

  getStyles() {
    return ["MMM-ImagesPhotos.css"];
  },

  getScripts() {
    return [];
  },

  async getPhotos(isRefresh = false) {
    const urlApHelper = `/MMM-ImagesPhotos/photos/${this.identifier}`;
    try {
      const response = await fetch(urlApHelper);
      if (response.ok) {
        this.photos = await response.json();
        this.loaded = true;
        this.photoDeck = [];
        if (this.photos.length > 0) {
          if (!isRefresh || !this.nextPhoto) {
            this.prepareNextPhoto();
          }
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

  notificationReceived(notification) {
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
      this.getPhotos(false);
    }
    if (notification === "METADATA_RESPONSE" && payload.id === this.identifier) {
      if (this.config.debugToConsole) {
        Log.log(`[MMM-ImagesPhotos] METADATA_RESPONSE received for: ${payload.photo.path}`);
      }
      this.nextPhoto = payload.photo;
      if (!this.currentPhoto) {
        this.triggerDomUpdate();
      }
    }
    if (notification === "SERVER_IP" && payload.id === this.identifier) {
      this.serverIp = payload.ip;
      this.ensureQrCodeOverlay();
    }
    if (notification === "PHOTOS_UPDATED" && payload.id === this.identifier) {
      Log.info(`[MMM-ImagesPhotos] Live photo list refresh triggered.`);
      this.getPhotos(true);
    }
    if (notification === "REMOTE_CONTROL" && payload.id === this.identifier) {
      this.handleRemoteControl(payload.action);
    }
    if (notification === "BRIGHTNESS_UPDATED" && payload.id === this.identifier) {
      this.applyDimOverlay(payload.brightness);
    }
    if (notification === "DISPLAY_STATE_UPDATED" && payload.id === this.identifier) {
      this.applyDisplayState(payload);
    }
    if (notification === "FAVORITE_UPDATED" && payload.id === this.identifier) {
      if (this.currentPhoto && this.currentPhoto.path === payload.path) {
        this.currentPhoto.isFavorite = payload.isFavorite;
        this.updateFavoriteBadgeDom();
      }
      this.photos.forEach((p) => {
        if (p.path === payload.path) p.isFavorite = payload.isFavorite;
      });
    }
  },

  handleRemoteControl(action) {
    Log.info(`[MMM-ImagesPhotos] Remote control: ${action}`);
    if (action === "pause") {
      this.setPaused(true);
    } else if (action === "resume") {
      this.setPaused(false);
    } else if (action === "toggle-pause") {
      this.setPaused(!this.paused);
    } else if (action === "next") {
      this.advanceNow();
    } else if (action === "prev") {
      this.goPrevNow();
    }
  },

  setPaused(shouldPause) {
    this.paused = Boolean(shouldPause);
    this.updatePauseBadge();
    if (this.paused) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    } else {
      this.waitForNextPhotoAndUpdate(1200);
    }
    this.reportCurrentPhoto();
  },

  advanceNow() {
    this.clearFadeTimers();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.nextPhoto) {
      this.prepareNextPhoto();
    }
    this.waitForNextPhotoAndUpdate(0);
  },

  goPrevNow() {
    if (!this.photoHistory || this.photoHistory.length === 0) {
      Log.info(`[MMM-ImagesPhotos] No previous photo in history.`);
      return;
    }
    this.clearFadeTimers();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const prevPhoto = this.photoHistory.pop();
    this.nextPhoto = prevPhoto;
    this.goingBack = true;
    this.triggerDomUpdate();
  },

  updateFavoriteBadgeDom() {
    if (!this.fg || !this.currentPhoto) return;
    const exifBox = this.fg.querySelector(".exif-info");
    if (!exifBox) return;
    const existing = exifBox.querySelector(".mmip-fav-badge");
    if (this.currentPhoto.isFavorite && !existing) {
      const badge = document.createElement("span");
      badge.className = "mmip-fav-badge";
      badge.textContent = "⭐ 즐겨찾기";
      exifBox.prepend(document.createElement("br"));
      exifBox.prepend(badge);
    } else if (!this.currentPhoto.isFavorite && existing) {
      const nextEl = existing.nextSibling;
      existing.remove();
      if (nextEl && nextEl.nodeName === "BR") nextEl.remove();
    }
  },

  applyDisplayState(state) {
    if (typeof state.galleryMode === "boolean") {
      this.galleryMode = state.galleryMode;
      if (typeof document !== "undefined" && document.body) {
        document.body.classList.toggle("mmip-gallery-mode", this.galleryMode);
      }
    }
    const prevMode = this.filterMode;
    const prevFolder = this.filterFolder;
    if (typeof state.filterMode === "string") {
      this.filterMode = state.filterMode;
    }
    if (typeof state.filterFolder === "string") {
      this.filterFolder = state.filterFolder;
    }
    if (prevMode !== this.filterMode || prevFolder !== this.filterFolder) {
      this.photoDeck = [];
      this.nextPhoto = null;
      if (this.loaded && this.photos.length > 0) {
        this.prepareNextPhoto();
        this.advanceNow();
      }
    }
  },

  applyDimOverlay(brightnessPercent) {
    if (typeof document === "undefined" || !document.body) return;
    const pct = Math.max(15, Math.min(100, Number(brightnessPercent) || 100));
    let overlay = document.getElementById("mmip-dim-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "mmip-dim-overlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.backgroundColor = "#000";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "99999";
      overlay.style.transition = "opacity 0.45s ease";
      overlay.style.opacity = "0";
      document.body.appendChild(overlay);
    }
    const dimOpacity = Math.max(0, Math.min(0.85, (100 - pct) / 100));
    overlay.style.opacity = dimOpacity.toFixed(2);
  },

  updatePauseBadge() {
    if (!this.overlayRoot) return;
    if (this.paused) {
      if (!this.pauseBadgeEl) {
        const badge = document.createElement("div");
        badge.className = "mmip-pause-badge";
        badge.textContent = "⏸ 일시정지";
        this.overlayRoot.appendChild(badge);
        this.pauseBadgeEl = badge;
      }
    } else if (this.pauseBadgeEl) {
      this.pauseBadgeEl.remove();
      this.pauseBadgeEl = null;
    }
  },

  reportCurrentPhoto() {
    if (!this.currentPhoto) return;
    this.sendSocketNotification("CURRENT_PHOTO", {
      id: this.identifier,
      path: this.currentPhoto.path,
      url: this.currentPhoto.url,
      companionPath: this.currentPhoto.companion ? this.currentPhoto.companion.path : null,
      effect: this.currentPhoto.effect || null,
      paused: this.paused
    });
  },

  prepareNextPhoto() {
    if (this.photos.length === 0) return;
    const nextPhoto = this.randomPhoto();
    if (!nextPhoto) {
      if (this.config.debugToConsole) {
        Log.warn(`[MMM-ImagesPhotos] prepareNextPhoto: No photos available after filtering`);
      }
      return;
    }
    if (this.config.debugToConsole) {
      Log.log(`[MMM-ImagesPhotos] prepareNextPhoto: requesting metadata for: ${nextPhoto.path}`);
    }
    this.sendSocketNotification("GET_METADATA", { id: this.identifier, photo: nextPhoto });
  },

  scheduleUpdate(delay) {
    let nextLoad = this.config.getInterval;
    if (typeof delay !== "undefined" && delay >= 0) {
      nextLoad = delay;
    }
    setTimeout(() => {
      this.getPhotos(false);
    }, nextLoad);
  },

  getFilteredPhotos() {
    let base = this.config.enableVideoPlayback
      ? this.photos
      : this.photos.filter((photo) => !this.isVideo(photo));

    if (this.filterMode === "favorites") {
      const favs = base.filter((p) => p.isFavorite === true);
      if (favs.length > 0) return favs;
    } else if (this.filterMode === "faces") {
      const faced = base.filter((p) => p.hasFaces === true);
      if (faced.length > 0) return faced;
    } else if (this.filterMode === "videos") {
      const vids = this.photos.filter((p) => this.isVideo(p));
      if (vids.length > 0) return vids;
    } else if (this.filterMode === "folder" && this.filterFolder) {
      const prefix = this.filterFolder.split(String.fromCharCode(92)).join("/").replace(/\/+$/, "") + "/";
      const matched = base.filter((p) => p.path.split(String.fromCharCode(92)).join("/").startsWith(prefix));
      if (matched.length > 0) return matched;
    }

    return base;
  },

  buildPhotoDeck(filteredPhotos) {
    const deck = filteredPhotos.slice();

    const seasonalMultiplier = Math.max(1, Math.round(Number(this.config.seasonalWeight) || 5));

    // Apply weights cleanly without over-stacking (seasonal/anniversary = 5x, favorite = +1)
    filteredPhotos.forEach((p) => {
      const isMemoryOrSeason = Boolean(
        (p.memoryYearsAgo && p.memoryYearsAgo >= 1) ||
        (p.nearMemoryYearsAgo && p.nearMemoryYearsAgo >= 1) ||
        p.isSameSeason
      );
      let extraCopies = isMemoryOrSeason ? seasonalMultiplier - 1 : 0;
      if (p.isFavorite === true) {
        extraCopies += 1;
      }
      for (let c = 0; c < extraCopies; c++) {
        deck.push(p);
      }
    });

    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }

    // Prevent back-to-back identical photos caused by higher weights
    for (let i = 1; i < deck.length; i++) {
      if (deck[i].path === deck[i - 1].path) {
        for (let k = i + 1; k < deck.length; k++) {
          if (deck[k].path !== deck[i - 1].path) {
            const tmp = deck[i];
            deck[i] = deck[k];
            deck[k] = tmp;
            break;
          }
        }
      }
    }

    // Prioritize up to 2 "On This Day" or "This Week" memory photos near the front
    const memories = deck.filter(
      (p) => (p.memoryYearsAgo && p.memoryYearsAgo >= 1) || (p.nearMemoryYearsAgo && p.nearMemoryYearsAgo >= 1)
    );
    if (memories.length > 0 && deck.length > 3) {
      const seen = new Set();
      const featured = [];
      for (const m of memories) {
        if (!seen.has(m.path)) {
          seen.add(m.path);
          featured.push(m);
          if (featured.length >= 2) break;
        }
      }
      featured.forEach((m, idx) => {
        const pos = deck.indexOf(m);
        if (pos > -1) {
          deck.splice(pos, 1);
          const insertAt = Math.min(idx * 2, deck.length);
          deck.splice(insertAt, 0, m);
        }
      });
    }

    // Avoid immediate back-to-back repeat across deck boundaries
    if (deck.length > 1 && this.lastDrawnPath && deck[0].path === this.lastDrawnPath) {
      const first = deck.shift();
      deck.push(first);
    }

    return deck;
  },

  randomPhoto() {
    const filteredPhotos = this.getFilteredPhotos();
    if (filteredPhotos.length === 0) return null;

    if (this.config.sequential) {
      const photoIndex = (this.lastPhotoIndex + 1) % filteredPhotos.length;
      this.lastPhotoIndex = photoIndex;
      const chosen = filteredPhotos[photoIndex];
      this.lastDrawnPath = chosen.path;
      return chosen;
    }

    if (!this.photoDeck || this.photoDeck.length === 0) {
      this.photoDeck = this.buildPhotoDeck(filteredPhotos);
    }

    const chosen = this.photoDeck.shift();
    this.lastDrawnPath = chosen.path;
    return chosen;
  },

  pickCollageCompanion(primaryPhoto) {
    if (!this.config.enablePortraitCollage || !this.fullscreen) return null;
    if (!primaryPhoto || this.isVideo(primaryPhoto)) return null;
    const prob = typeof this.config.collageProbability === "number" ? this.config.collageProbability : 0.5;
    if (Math.random() >= prob) return null;

    const isScreenPortrait = window.innerHeight > window.innerWidth;
    const isPrimaryPortrait = this.isPhotoPortrait(primaryPhoto);

    // 세로 모니터(1080x1920) -> 가로 사진 2장을 상하 2단 콜라주
    // 가로 모니터(1920x1080) -> 세로 사진 2장을 좌우 2열 콜라주
    const needPortraitPair = !isScreenPortrait;
    if (isPrimaryPortrait !== needPortraitPair) return null;

    if (this.photoDeck && this.photoDeck.length > 0) {
      const idx = this.photoDeck.findIndex(
        (p) =>
          p.path !== primaryPhoto.path &&
          !this.isVideo(p) &&
          typeof p.isPortrait === "boolean" &&
          p.isPortrait === needPortraitPair
      );
      if (idx !== -1) {
        return {
          photo: this.photoDeck.splice(idx, 1)[0],
          layout: isScreenPortrait ? "vertical" : "horizontal"
        };
      }
    }
    return null;
  },

  isPhotoPortrait(photoImage) {
    if (photoImage.face && photoImage.face.width && photoImage.face.height) {
      return photoImage.face.height > photoImage.face.width;
    }
    if (photoImage.exif && photoImage.exif.tags) {
      const t = photoImage.exif.tags;
      const w = t.ImageWidth || t.ExifImageWidth;
      const h = t.ImageHeight || t.ExifImageHeight;
      if (w && h) {
        const orientation = t.Orientation || 1;
        const rotated = orientation >= 5 && orientation <= 8;
        return rotated ? w > h : h > w;
      }
    }
    return photoImage.isPortrait === true;
  },

  scaleImage(srcwidth, srcheight, targetwidth, targetheight, fLetterBox) {
    const result = { width: 0, height: 0, fScaleToTargetWidth: true };
    if (srcwidth <= 0 || srcheight <= 0 || targetwidth <= 0 || targetheight <= 0) {
      return result;
    }

    const scaleX1 = targetwidth;
    const scaleY1 = (srcheight * targetwidth) / srcwidth;
    const scaleX2 = (srcwidth * targetheight) / srcheight;
    const scaleY2 = targetheight;

    let fScaleOnWidth = scaleX2 > targetwidth;
    fScaleOnWidth = fScaleOnWidth ? fLetterBox : !fLetterBox;

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
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      if (count === 0) return null;
      return `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
    } catch (e) {
      return null;
    }
  },

  triggerDomUpdate() {
    const speed = this.fullscreen ? 0 : this.config.animationSpeed;
    this.updateDom(speed);
  },

  waitForNextPhotoAndUpdate(delayMs = 0) {
    const self = this;
    const checkInterval = 300;
    const maxWait = 15000;
    let elapsed = 0;

    const attempt = () => {
      if (self.suspended || self.paused) return;
      if (self.nextPhoto) {
        self.triggerDomUpdate();
      } else if (elapsed >= maxWait) {
        self.triggerDomUpdate();
      } else {
        elapsed += checkInterval;
        self.timer = setTimeout(attempt, checkInterval);
      }
    };

    if (self.timer) clearTimeout(self.timer);
    if (!self.paused) {
      self.timer = setTimeout(attempt, delayMs);
    }
  },

  createQrCodeNode() {
    if (!this.config.showUploadQrCode) return null;

    let finalUrl = this.config.uploadUrl;
    if (!finalUrl && this.serverIp) {
      finalUrl = `http://${this.serverIp}:${this.config.uploadPort}`;
    }
    if (!finalUrl) return null;

    const qrBase = this.serverIp
      ? `http://${this.serverIp}:${this.config.uploadPort}`
      : `http://127.0.0.1:${this.config.uploadPort}`;

    const qrWrapper = document.createElement("div");
    qrWrapper.className = "mmip-qr-code";
    qrWrapper.style.position = "absolute";
    qrWrapper.style.zIndex = 100;
    qrWrapper.style.padding = "10px";
    qrWrapper.style.backgroundColor = "rgba(0, 0, 0, 0.52)";
    qrWrapper.style.borderRadius = "12px";

    if (this.config.qrCodePosition.includes("bottom")) qrWrapper.style.bottom = "20px";
    if (this.config.qrCodePosition.includes("top")) qrWrapper.style.top = "20px";
    if (this.config.qrCodePosition.includes("left")) qrWrapper.style.left = "20px";
    if (this.config.qrCodePosition.includes("right")) qrWrapper.style.right = "20px";

    const qrImg = document.createElement("img");
    qrImg.src = `${qrBase}/qr?data=${encodeURIComponent(finalUrl)}`;
    qrImg.style.width = "100px";
    qrImg.style.height = "100px";
    qrImg.style.display = "block";
    qrImg.style.borderRadius = "6px";
    qrImg.style.backgroundColor = "#fff";

    const text = document.createElement("div");
    text.innerHTML = "📸 사진 업로드";
    text.style.color = "white";
    text.style.fontSize = "14px";
    text.style.textAlign = "center";
    text.style.marginTop = "8px";
    text.style.fontWeight = "bold";

    qrWrapper.appendChild(qrImg);
    qrWrapper.appendChild(text);
    return qrWrapper;
  },

  ensureQrCodeOverlay() {
    if (!this.overlayRoot || this.qrRendered) return;
    const qrNode = this.createQrCodeNode();
    if (qrNode) {
      this.overlayRoot.appendChild(qrNode);
      this.qrRendered = true;
    }
  },

  clearFadeTimers() {
    if (Array.isArray(this.fadeTimers)) {
      this.fadeTimers.forEach((id) => clearTimeout(id));
      this.fadeTimers = [];
    }
  },

  scheduleFadeTimer(fn, delay) {
    const id = setTimeout(() => {
      this.fadeTimers = this.fadeTimers.filter((t) => t !== id);
      fn();
    }, delay);
    this.fadeTimers.push(id);
    return id;
  },

  cleanupFaceStyles() {
    if (typeof document === "undefined" || !document.head) return;
    document.head.querySelectorAll("style[data-mmip-face-style=true]").forEach((el) => {
      el.remove();
    });
  },

  handleVideoPlayback(video, photoImage, prevLayer) {
    const self = this;
    const displayDuration = this.config.updateInterval * this.config.videoPlaybackMultiplier;
    const fadeDuration = this.transitionDefaults.fadeDuration;
    let videoLoadTimeout = null;
    let isVideoFailed = false;

    const handleVideoFailure = (reason = "Unknown error") => {
      if (isVideoFailed) return;
      isVideoFailed = true;
      if (videoLoadTimeout) clearTimeout(videoLoadTimeout);
      if (self.timer) clearTimeout(self.timer);
      Log.warn(`[MMM-ImagesPhotos] Video playback failed for ${photoImage.url}: ${reason}`);
      self.nextPhoto = null;
      self.prepareNextPhoto();
      self.waitForNextPhotoAndUpdate(self.config.retryDelay);
    };

    videoLoadTimeout = setTimeout(() => {
      if (!isVideoFailed && video.readyState < 2) {
        handleVideoFailure("Video load timeout");
      }
    }, 10000);

    video.onloadeddata = () => {
      if (isVideoFailed) return;
      if (videoLoadTimeout) clearTimeout(videoLoadTimeout);

      const videoDuration = video.duration * 1000;
      if (videoDuration < displayDuration) {
        video.loop = true;
      } else if (videoDuration > displayDuration) {
        video.loop = false;
        const maxStartTime = video.duration - (displayDuration / 1000);
        video.currentTime = Math.random() * maxStartTime;
      } else {
        video.loop = false;
      }

      video.play().catch((err) => handleVideoFailure(`Play error: ${err.message}`));

      const layer = video.parentElement;
      if (layer) {
        layer.style.transition = `opacity ${fadeDuration}ms ease-in-out`;
        layer.style.opacity = 1;
      }
      if (prevLayer) {
        self.scheduleFadeTimer(() => {
          while (prevLayer.firstChild) prevLayer.removeChild(prevLayer.firstChild);
          prevLayer.style.opacity = 0;
        }, fadeDuration + 150);
      }

      if (self.timer) clearTimeout(self.timer);
      if (!self.paused) {
        self.timer = setTimeout(() => {
          if (self.config.transitionMode !== "crossfade" && layer) {
            layer.style.transition = `opacity ${fadeDuration}ms ease-in-out`;
            layer.style.opacity = 0;
            self.waitForNextPhotoAndUpdate(fadeDuration);
          } else {
            self.waitForNextPhotoAndUpdate(0);
          }
        }, displayDuration);
      }
    };

    video.onerror = (evt) => {
      const error = evt.target.error;
      const reason = error ? `MediaError code ${error.code}` : "Unknown error";
      handleVideoFailure(reason);
    };

    video.src = photoImage.url;
  },

  animateTransition(imgEl, container, prevLayer = null) {
    const self = this;
    const cfg = self.config || {};
    const defs = self.transitionDefaults || {};

    const displayDuration = cfg.updateInterval || defs.displayDuration;
    const blackDuration = cfg.blackDuration || defs.blackDuration;
    const fadeDuration = cfg.fadeDuration || defs.fadeDuration;
    const easing = cfg.transitionEasing || defs.easing;
    const isCrossfade = self.fullscreen && cfg.transitionMode === "crossfade";

    const fgContainer = imgEl.closest ? imgEl.closest(".mmip-foreground") : imgEl.parentElement;
    const mainContainer = self.fullscreen ? self.bk : container;
    if (mainContainer) {
      mainContainer.style.backgroundColor = "black";
    }

    self.clearFadeTimers();
    if (self.timer) clearTimeout(self.timer);

    const avg = self.computeAverageColor(imgEl);

    if (isCrossfade && fgContainer) {
      fgContainer.style.backgroundColor = avg || "black";
      fgContainer.style.opacity = 0;
      void fgContainer.offsetWidth;
      fgContainer.style.transition = `opacity ${fadeDuration}ms ${easing}`;

      // Smoothly crossfade new layer over previous layer (zero black flash)
      self.scheduleFadeTimer(() => {
        fgContainer.style.opacity = 1;
      }, 50);

      if (prevLayer) {
        self.scheduleFadeTimer(() => {
          while (prevLayer.firstChild) prevLayer.removeChild(prevLayer.firstChild);
          prevLayer.style.transition = "none";
          prevLayer.style.opacity = 0;
        }, fadeDuration + 250);
      }

      self.waitForNextPhotoAndUpdate(fadeDuration + displayDuration);
      return;
    }

    // Classic black -> smooth fade-in -> display -> smooth fade-out mode
    const nextUpdateDelay = blackDuration + fadeDuration + displayDuration + fadeDuration;
    self.waitForNextPhotoAndUpdate(nextUpdateDelay);

    if (fgContainer) {
      fgContainer.style.backgroundColor = avg || "black";
      fgContainer.style.opacity = 0;
      void fgContainer.offsetWidth;
      fgContainer.style.transition = `opacity ${fadeDuration}ms ${easing}`;

      self.scheduleFadeTimer(() => {
        fgContainer.style.opacity = 1;
      }, blackDuration);

      self.scheduleFadeTimer(() => {
        fgContainer.style.opacity = 0;
      }, blackDuration + fadeDuration + displayDuration);
    }
  },

  suspend() {
    this.suspended = true;
    this.clearFadeTimers();
    this.cleanupFaceStyles();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  resume() {
    this.suspended = false;
    if (!this.paused) {
      this.triggerDomUpdate();
    }
  },

  getDom() {
    if (!this.nextPhoto && this.loaded) {
      if (this.wrapper && this.fullscreen) {
        return this.wrapper;
      }
      const wrapper = document.createElement("div");
      if (this.config.debugToConsole) {
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

    this.clearFadeTimers();
    this.cleanupFaceStyles();

    if (!this.goingBack && this.currentPhoto) {
      this.photoHistory.push(JSON.parse(JSON.stringify(this.currentPhoto)));
      if (this.photoHistory.length > 25) {
        this.photoHistory.shift();
      }
    }
    this.goingBack = false;

    this.currentPhoto = JSON.parse(JSON.stringify(this.nextPhoto));
    this.nextPhoto = null;

    this.prepareNextPhoto();

    if (this.fullscreen) {
      return this.getDomFS();
    }
    return this.getDomnotFS();
  },

  isVideo(photo) {
    const videoExtensions = ["mp4", "webm", "ogg", "mov"];
    const url = photo.url.toLowerCase();
    return videoExtensions.some((ext) => url.endsWith(`.${ext}`));
  },

  pickRegularEffect() {
    const stillProb = typeof this.config.stillProbability === "number" ? this.config.stillProbability : 0.25;
    const movingEffects = this.config.imageEffects.filter((e) => e !== "ip-face-zoom" && e !== "ip-still");
    const randomDuration = (20 + Math.random() * 20).toFixed(2) + "s";

    if (movingEffects.length === 0 || Math.random() < stillProb) {
      return { effectClass: "ip-still", duration: randomDuration, label: "ip-still" };
    }

    const randomEffect = movingEffects[Math.floor(Math.random() * movingEffects.length)];
    return { effectClass: randomEffect, duration: randomDuration, label: `${randomEffect} ${randomDuration}` };
  },

  createExifWrapper(photoImage) {
    if (!this.config.showExif || !photoImage) return null;

    const exifWrapper = document.createElement("div");
    exifWrapper.className = "exif-info";
    const infoParts = [];
    const tags = photoImage.exif && photoImage.exif.tags ? photoImage.exif.tags : null;

    if (photoImage.isFavorite) {
      infoParts.push(`<span class="mmip-fav-badge">⭐ 즐겨찾기</span>`);
    }
    if (photoImage.memoryYearsAgo && photoImage.memoryYearsAgo >= 1) {
      infoParts.push(`<span class="mmip-memory-badge">🎂 ${photoImage.memoryYearsAgo}년 전 오늘</span>`);
    } else if (photoImage.nearMemoryYearsAgo && photoImage.nearMemoryYearsAgo >= 1) {
      infoParts.push(`<span class="mmip-season-badge">🌸 ${photoImage.nearMemoryYearsAgo}년 전 이맘때</span>`);
    }

    if (tags) {
      const timestamp = tags.DateTimeOriginal;
      if (timestamp && typeof timestamp === "number") {
        const dateObj = new Date(timestamp * 1000);
        const year = dateObj.getUTCFullYear();
        const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
        const day = String(dateObj.getUTCDate()).padStart(2, "0");
        const hour = String(dateObj.getUTCHours()).padStart(2, "0");
        const minute = String(dateObj.getUTCMinutes()).padStart(2, "0");
        infoParts.push(`🗓️ ${year}-${month}-${day} ${hour}:${minute}`);
      }
    }
    if (photoImage.location) {
      infoParts.push(`📍 ${photoImage.location}`);
    }
    if (tags && tags.Model) {
      infoParts.push(`📷 ${tags.Model}`);
    }
    if (tags) {
      const photoParamParts = [];
      if (tags.FocalLength) photoParamParts.push(`${tags.FocalLength}mm`);
      if (tags.FNumber) photoParamParts.push(`f/${tags.FNumber.toFixed(1)}`);
      if (tags.ExposureTime) {
        const exposureTime = tags.ExposureTime;
        photoParamParts.push(exposureTime < 1 ? `1/${Math.round(1 / exposureTime)}s` : `${exposureTime}s`);
      }
      if (tags.ISO) photoParamParts.push(`ISO ${tags.ISO}`);
      if (photoParamParts.length > 0) {
        infoParts.push(`⚙️ ${photoParamParts.join(" ")}`);
      }
    }

    const effectLabel = photoImage.effect || "still";
    const faceCount = photoImage.face && typeof photoImage.face.count === "number" ? photoImage.face.count : 0;
    let effectString = `✨ ${effectLabel}`;
    if (faceCount > 0) {
      effectString += ` (${faceCount}👤)`;
    }
    infoParts.push(effectString);

    if (infoParts.length > 0) {
      exifWrapper.innerHTML = infoParts.join("<br>");
      return exifWrapper;
    }
    return null;
  },

  getDomnotFS() {
    const self = this;
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.overflow = "hidden";
    const photoImage = this.currentPhoto;

    if (photoImage) {
      const fg = document.createElement("div");
      fg.className = "mmip-foreground";
      fg.style.opacity = 0;
      fg.style.backgroundColor = "black";
      wrapper.appendChild(fg);

      if (this.isVideo(photoImage)) {
        const video = document.createElement("video");
        video.className = "mmip-video";
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.preload = "auto";
        video.style.opacity = this.config.opacity;
        this.handleVideoPlayback(video, photoImage, null);
        fg.appendChild(video);
        photoImage.effect = "video";
      } else {
        const img = document.createElement("img");
        img.id = "mmm-images-photos";
        img.style.maxWidth = this.config.maxWidth;
        img.style.maxHeight = this.config.maxHeight;
        img.style.opacity = this.config.opacity;

        let finalEffect = "";
        let isFaceZoom = false;
        if (this.config.faceDetection && this.config.imageEffects.includes("ip-face-zoom") && photoImage.face && photoImage.face.faces && photoImage.face.faces.length > 0) {
          if (Math.random() < 0.4) isFaceZoom = true;
        }

        if (isFaceZoom) {
          const faces = photoImage.face.faces;
          const face = faces[Math.floor(Math.random() * faces.length)];
          const zoomIn = Math.random() < 0.5;
          const fx_perc = (face.x + face.w / 2) / photoImage.face.width;
          const fy_perc = (face.y + face.h / 2) / photoImage.face.height;
          if (zoomIn) {
            const S = 1.15;
            const Tx = Math.max(-15, Math.min(15, (0 - S * (fx_perc - 0.5)) * 100));
            const Ty = Math.max(-15, Math.min(15, (-0.2 - S * (fy_perc - 0.5)) * 100));
            const duration = (20 + Math.random() * 20).toFixed(2);
            const keyframeName = `face-pan-zoom-${Date.now()}`;
            const styleEl = document.createElement("style");
            styleEl.setAttribute("data-mmip-face-style", "true");
            styleEl.innerHTML = `@keyframes ${keyframeName} { 0% { transform: translate(0%, 0%) scale(var(--base-scale)); } 100% { transform: translate(${Tx}%, ${Ty}%) scale(calc(var(--base-scale) * ${S})); } }`;
            document.head.appendChild(styleEl);
            img.style.animation = `${keyframeName} ${duration}s ease-in-out both`;
            finalEffect = "ip-face-pan-zoom-in";
          } else {
            img.style.transformOrigin = `${fx_perc * 100}% ${fy_perc * 100}%`;
            img.className = "bgimage mmip-bgimage ip-face-zoom-out";
            const randomDuration = (20 + Math.random() * 20).toFixed(2) + "s";
            img.style.animationDuration = randomDuration;
            finalEffect = `ip-face-zoom-out ${randomDuration}`;
          }
        } else {
          const picked = this.pickRegularEffect();
          img.className = `bgimage mmip-bgimage ${picked.effectClass}`;
          img.style.animationDuration = picked.duration;
          finalEffect = picked.label;
        }

        img.classList.add(this.isPhotoPortrait(photoImage) ? "portrait" : "landscape");
        photoImage.effect = finalEffect;

        img.onerror = (evt) => {
          Log.error("MMM-ImagesPhotos image load failed", evt.currentTarget.src);
          setTimeout(() => self.updateDom(), self.config.retryDelay);
        };
        img.onload = (evt) => {
          try { self.animateTransition(evt.currentTarget, wrapper, null); } catch (e) { Log.warn(self.name, e); }
        };
        try { img.crossOrigin = "Anonymous"; } catch (e) {}

        fg.appendChild(img);
        img.src = photoImage.url;

        if (this.config.showExif) {
          const exifWrapper = this.createExifWrapper(photoImage);
          if (exifWrapper) fg.appendChild(exifWrapper);
        }
      }

      const qrNode = this.createQrCodeNode();
      if (qrNode) fg.appendChild(qrNode);
      this.reportCurrentPhoto();
    }
    return wrapper;
  },

  getDomFS() {
    const self = this;
    if (this.wrapper === null) {
      this.wrapper = document.createElement("div");
      this.bk = document.createElement("div");
      this.bk.className = "bgimagefs";
      this.wrapper.appendChild(this.bk);

      const fg0 = document.createElement("div");
      fg0.className = "mmip-foreground mmip-layer-under";
      fg0.style.opacity = 0;
      const fg1 = document.createElement("div");
      fg1.className = "mmip-foreground mmip-layer-over";
      fg1.style.opacity = 0;

      this.wrapper.appendChild(fg0);
      this.wrapper.appendChild(fg1);
      this.fgLayers = [fg0, fg1];
      this.activeLayerIdx = 0;

      this.overlayRoot = document.createElement("div");
      this.overlayRoot.className = "mmip-overlay-root";
      this.wrapper.appendChild(this.overlayRoot);
      this.qrRendered = false;
    }

    this.ensureQrCodeOverlay();
    this.updatePauseBadge();

    if (this.config.fill === true) {
      this.bk.style.filter = `blur(${this.config.blur}px)`;
      this.bk.style["-webkit-filter"] = `blur(${this.config.blur}px)`;
    } else {
      this.bk.style.backgroundColor = "black";
    }

    const photoImage = this.currentPhoto;
    if (this.photos.length && photoImage) {
      const isCrossfade = this.config.transitionMode === "crossfade";
      const prevLayer = isCrossfade ? this.fgLayers[this.activeLayerIdx] : null;
      const nextLayerIdx = isCrossfade ? 1 - this.activeLayerIdx : 0;
      const targetLayer = this.fgLayers[nextLayerIdx];
      this.activeLayerIdx = nextLayerIdx;
      this.fg = targetLayer;

      if (prevLayer) {
        prevLayer.classList.remove("mmip-layer-over");
        prevLayer.classList.add("mmip-layer-under");
      }
      targetLayer.classList.remove("mmip-layer-under");
      targetLayer.classList.add("mmip-layer-over");

      while (targetLayer.firstChild) {
        targetLayer.removeChild(targetLayer.firstChild);
      }
      targetLayer.style.transition = "none";
      targetLayer.style.opacity = 0;

      if (this.isVideo(photoImage)) {
        const video = document.createElement("video");
        video.className = "mmip-video";
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.preload = "auto";
        video.style.opacity = this.config.opacity;
        this.handleVideoPlayback(video, photoImage, prevLayer);
        targetLayer.appendChild(video);
        photoImage.effect = "video-fs";
        if (this.config.fill === true) {
          this.bk.style.backgroundImage = "";
          this.bk.style.backgroundColor = "black";
        }
      } else {
        const collageMatch = this.pickCollageCompanion(photoImage);

        if (collageMatch) {
          // --- ORIENTATION-AWARE 2-UP COLLAGE ---
          const companion = collageMatch.photo;
          photoImage.companion = companion;
          const grid = document.createElement("div");
          grid.className = `mmip-collage-grid mmip-collage-${collageMatch.layout}`;

          const picked = this.pickRegularEffect();
          photoImage.effect = `collage-${collageMatch.layout} · ${picked.effectClass}`;

          const pair = [photoImage, companion];
          let loadedCount = 0;
          let firstImgEl = null;

          pair.forEach((item, idx) => {
            const cell = document.createElement("div");
            cell.className = "mmip-collage-cell";
            const img = document.createElement("img");
            const eff = idx === 0 ? picked : this.pickRegularEffect();
            const orientCls = collageMatch.layout === "vertical" ? "landscape" : "portrait";
            img.className = `bgimage mmip-bgimage mmip-collage-img ${orientCls} ${eff.effectClass}`;
            img.style.animationDuration = eff.duration;
            img.style.opacity = self.config.opacity;
            try { img.crossOrigin = "Anonymous"; } catch (e) {}

            img.onload = () => {
              if (!firstImgEl) firstImgEl = img;
              loadedCount++;
              if (loadedCount === 2) {
                try { self.animateTransition(firstImgEl, self.bk, prevLayer); } catch (e) { Log.warn(self.name, e); }
              }
            };
            img.onerror = () => {
              loadedCount++;
              if (loadedCount === 2 && firstImgEl) {
                try { self.animateTransition(firstImgEl, self.bk, prevLayer); } catch (e) { Log.warn(self.name, e); }
              }
            };

            img.src = item.url;
            cell.appendChild(img);

            const capParts = [];
            if (item.isFavorite) capParts.push("⭐");
            if (item.memoryYearsAgo && item.memoryYearsAgo >= 1) capParts.push(`🎂 ${item.memoryYearsAgo}년 전 오늘`);
            else if (item.nearMemoryYearsAgo && item.nearMemoryYearsAgo >= 1) capParts.push(`🌸 ${item.nearMemoryYearsAgo}년 전 이맘때`);
            let dateLabel = item.dateStr || "";
            if (!dateLabel && item.exif && item.exif.tags && typeof item.exif.tags.DateTimeOriginal === "number") {
              const d = new Date(item.exif.tags.DateTimeOriginal * 1000);
              dateLabel = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
            }
            if (dateLabel) capParts.push(`🗓️ ${dateLabel}`);
            if (capParts.length > 0) {
              const cap = document.createElement("div");
              cap.className = "mmip-collage-caption";
              cap.textContent = capParts.join(" · ");
              cell.appendChild(cap);
            }

            grid.appendChild(cell);
          });

          targetLayer.appendChild(grid);
          if (this.config.showExif) {
            const exifWrapper = this.createExifWrapper(photoImage);
            if (exifWrapper) targetLayer.appendChild(exifWrapper);
          }
        } else {
          // --- SINGLE IMAGE LOGIC (FS) ---
          const img = document.createElement("img");

          const picked = this.pickRegularEffect();
          img.className = `bgimage mmip-bgimage ${picked.effectClass}`;
          img.style.animationDuration = picked.duration;
          const finalEffect = picked.label;

          img.classList.add(this.isPhotoPortrait(photoImage) ? "portrait" : "landscape");
          photoImage.effect = finalEffect;

          img.style.position = "absolute";
          img.style.opacity = self.config.opacity;

          img.onerror = (evt) => {
            Log.error("MMM-ImagesPhotos image load failed", evt.currentTarget.src);
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

            try { self.animateTransition(eventImage, self.bk, prevLayer); } catch (e) { Log.warn(self.name, e); }
          };

          try { img.crossOrigin = "Anonymous"; } catch (e) {}
          img.src = photoImage.url;
          targetLayer.appendChild(img);

          if (this.config.showExif) {
            const exifWrapper = this.createExifWrapper(photoImage);
            if (exifWrapper) targetLayer.appendChild(exifWrapper);
          }
        }
      }

      this.reportCurrentPhoto();
    }
    return this.wrapper;
  },

  processPhotos(data) {
    this.photos = data;
    if (this.loaded === false) {
      if (this.suspended === false) {
        this.triggerDomUpdate();
      }
    }
    this.loaded = true;
  }
});
