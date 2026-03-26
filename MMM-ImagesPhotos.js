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
    ,enableVideoPlayback: true // 동영상 재생 여부 설정 (true: 재생, false: 이미지만)
    ,videoPlaybackMultiplier: 1.5 // 동영상 재생 시간을 사진보다 몇 배 길게 할지 (1.5 = 1.5배, 2 = 2배 등)
    ,imageEffects: [
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
    uploadUrl: "", // 비워두면 자동 감지된 IP 사용
    uploadPort: 8999, // 자동 감지된 IP와 조합될 기본 포트 번호
    qrCodePosition: "bottom-left" // "bottom-left", "bottom-right", "top-left", "top-right"
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
    if (notification === "SERVER_IP" && payload.id === this.identifier) {
      this.serverIp = payload.ip;
    }
  },

  prepareNextPhoto() {
    if (this.photos.length === 0) {
      return;
    }
    const nextPhoto = this.randomPhoto();
    if (!nextPhoto) {
      // 필터링된 사진이 없는 경우 (예: enableVideoPlayback=false이면서 동영상만 있는 경우)
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
   * Retrieve filtered photos based on enableVideoPlayback setting.
   *
   * return Array - Filtered photos array.
   */
  getFilteredPhotos() {
    if (this.config.enableVideoPlayback) {
      // 동영상 재생이 활성화되면 모든 파일 반환
      return this.photos;
    } else {
      // 동영상 재생이 비활성화되면 이미지 파일만 반환
      const filtered = this.photos.filter(photo => !this.isVideo(photo));
      if (filtered.length === 0 && this.config.debugToConsole) {
        Log.warn(`[MMM-ImagesPhotos] No image files found. All files appear to be videos.`);
      }
      return filtered;
    }
  },

  /*
   * Retrieve a random photo from filtered list.
   *
   * return photo Object - A random photo (filtered based on enableVideoPlayback setting), or null if no photos available.
   */
  randomPhoto() {
    const filteredPhotos = this.getFilteredPhotos();
    
    if (filteredPhotos.length === 0) {
      if (this.config.debugToConsole) {
        Log.warn(`[MMM-ImagesPhotos] No photos available after filtering. enableVideoPlayback=${this.config.enableVideoPlayback}`);
      }
      return null;
    }

    // Sequential 모드에서 인덱스 관리
    const generate = () => Math.floor(Math.random() * filteredPhotos.length);
    let photoIndex;

    if (this.config.sequential) {
      // Sequential: 순서대로 (마지막에 도달하면 처음부터 시작)
      photoIndex = (this.lastPhotoIndex + 1) % filteredPhotos.length;
    } else {
      // Random: 임의로 선택
      photoIndex = generate();
      // 현재 사진과 같지않은 사진 선택
      while (filteredPhotos.length > 1 && photoIndex === this.lastPhotoIndex) {
        photoIndex = generate();
      }
    }

    this.lastPhotoIndex = photoIndex;
    return filteredPhotos[photoIndex];
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

  waitForNextPhotoAndUpdate(delayMs = 0) {
    const self = this;
    const checkInterval = 300;
    const maxWait = 15000;
    let elapsed = 0;

    const attempt = () => {
      if (self.suspended) {
        return;
      }
      if (self.nextPhoto) {
        self.updateDom(self.config.animationSpeed);
      } else if (elapsed >= maxWait) {
        // Force update anyway to avoid stuck state
        self.updateDom(self.config.animationSpeed);
      } else {
        elapsed += checkInterval;
        self.timer = setTimeout(attempt, checkInterval);
      }
    };

    if (self.timer) {
      clearTimeout(self.timer);
    }
    self.timer = setTimeout(attempt, delayMs);
  },

  createQrCodeNode() {
    if (!this.config.showUploadQrCode) return null;
    
    // 설정된 URL이 없으면, 서버에서 전달받은 IP와 설정된 Port로 동적 URL 생성
    let finalUrl = this.config.uploadUrl;
    if (!finalUrl && this.serverIp) {
        finalUrl = `http://${this.serverIp}:${this.config.uploadPort}`;
    }
    if (!finalUrl) return null;

    const qrWrapper = document.createElement("div");
    qrWrapper.className = "mmip-qr-code";
    qrWrapper.style.position = "absolute";
    qrWrapper.style.zIndex = 100;
    qrWrapper.style.padding = "10px";
    qrWrapper.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    qrWrapper.style.borderRadius = "10px";

    // 설정된 위치값에 따라 배치
    if (this.config.qrCodePosition.includes("bottom")) qrWrapper.style.bottom = "20px";
    if (this.config.qrCodePosition.includes("top")) qrWrapper.style.top = "20px";
    if (this.config.qrCodePosition.includes("left")) qrWrapper.style.left = "20px";
    if (this.config.qrCodePosition.includes("right")) qrWrapper.style.right = "20px";

    const qrImg = document.createElement("img");
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(finalUrl)}`;
    qrImg.style.width = "100px";
    qrImg.style.height = "100px";
    qrImg.style.display = "block";

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

  handleVideoPlayback(video, photoImage) {
    const self = this;
    // 동영상 재생 시간 = 사진 표시 시간 × videoPlaybackMultiplier
    const displayDuration = this.config.updateInterval * this.config.videoPlaybackMultiplier;
    let videoLoadTimeout = null;
    let isVideoFailed = false;

    // 함수: 비디오 실패 처리 (중복 호출 방지)
    const handleVideoFailure = (reason = "Unknown error") => {
        if (isVideoFailed) return; // 이미 처리됨
        isVideoFailed = true;

        if (videoLoadTimeout) clearTimeout(videoLoadTimeout);
        if (self.timer) clearTimeout(self.timer);

        const errorMsg = `[MMM-ImagesPhotos] Video playback failed for ${photoImage.url}: ${reason}`;
        if (self.config.debugToConsole) {
            Log.warn(errorMsg);
            console.warn(errorMsg);
        } else {
            Log.warn(errorMsg);
        }

        self.nextPhoto = null;
        self.prepareNextPhoto();
        self.waitForNextPhotoAndUpdate(self.config.retryDelay);
    };

    // 비디오 로드 타임아웃 설정 (10초)
    videoLoadTimeout = setTimeout(() => {
        if (!isVideoFailed && video.readyState < 2) { // 아직 충분한 데이터가 로드되지 않음
            handleVideoFailure("Video load timeout - Unsupported format or network issue");
        }
    }, 10000);

    video.onloadeddata = () => {
        if (isVideoFailed) return;
        
        if (videoLoadTimeout) clearTimeout(videoLoadTimeout);
        
        const videoDuration = video.duration * 1000; // in ms

        if (videoDuration < displayDuration) {
            // Short video: loop and set a timeout
            video.loop = true;
            if (self.config.debugToConsole) {
                Log.log(`[MMM-ImagesPhotos] Short video (${videoDuration}ms). Looping for ${displayDuration}ms.`);
            }
        } else if (videoDuration > displayDuration) {
            // Long video: set random start time
            video.loop = false;
            const maxStartTime = video.duration - (displayDuration / 1000);
            const startTime = Math.random() * maxStartTime;
            video.currentTime = startTime;
            if (self.config.debugToConsole) {
                Log.log(`[MMM-ImagesPhotos] Long video (${videoDuration}ms). Starting at ${startTime.toFixed(2)}s for ${displayDuration}ms.`);
            }
        } else {
            video.loop = false;
        }

        video.play().catch(err => {
            handleVideoFailure(`Play error: ${err.message}`);
        });

        // Clear any existing timer
        if (self.timer) clearTimeout(self.timer);
        
        const fadeDuration = self.transitionDefaults.fadeDuration;
        // Schedule the fade-out and transition to the next photo
        self.timer = setTimeout(() => {
            const fg = video.parentElement;
            if (fg) {
                fg.style.transition = `opacity ${fadeDuration}ms ease-in-out`;
                fg.style.opacity = 0; // Fade out
            }
            self.waitForNextPhotoAndUpdate(fadeDuration);
        }, displayDuration);
    };

    video.onerror = (evt) => {
        const error = evt.target.error;
        let errorReason = "Unknown error";
        
        if (error) {
            switch(error.code) {
                case 1: // MEDIA_ERR_ABORTED
                    errorReason = "Video loading aborted";
                    break;
                case 2: // MEDIA_ERR_NETWORK
                    errorReason = "Network error - Cannot load video";
                    break;
                case 3: // MEDIA_ERR_DECODE
                    errorReason = "Decode error - Unsupported codec or pixel format";
                    break;
                case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
                    errorReason = "Source not supported - This video format is not compatible";
                    break;
                default:
                    errorReason = `Error code ${error.code}: ${error.message}`;
            }
        }
        
        handleVideoFailure(errorReason);
    };

    // 진행 상태 모니터링: stalled 감지
    video.onstalled = () => {
        if (!isVideoFailed && self.config.debugToConsole) {
            Log.warn(`[MMM-ImagesPhotos] Video stalled for ${photoImage.url}`);
        }
    };

    // Suspend 이벤트 처리
    video.onsuspend = () => {
        if (!isVideoFailed && self.config.debugToConsole) {
            Log.warn(`[MMM-ImagesPhotos] Video suspended for ${photoImage.url}`);
        }
    };

    video.src = photoImage.url;
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
    self.waitForNextPhotoAndUpdate(nextUpdateDelay);
    
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

  isVideo(photo) {
    const videoExtensions = ["mp4", "webm", "ogg", "mov"];
    const url = photo.url.toLowerCase();
    return videoExtensions.some(ext => url.endsWith(`.${ext}`));
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
      fg.style.opacity = 0; // start invisible
      wrapper.appendChild(fg);

      // --- Fade In Transition ---
      // Common fade-in logic for both video and image
      const blackDuration = this.transitionDefaults.blackDuration;
      const fadeDuration = this.transitionDefaults.fadeDuration;
      fg.style.backgroundColor = "black";
      setTimeout(() => {
        fg.style.transition = `opacity ${fadeDuration}ms ease-in-out`;
        fg.style.opacity = 1;
      }, blackDuration);
      // --- End Fade In ---

      if (this.isVideo(photoImage)) {
        // --- VIDEO LOGIC ---
        const video = document.createElement("video");
        video.className = "mmip-video";
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.preload = "auto";
        video.style.opacity = this.config.opacity;

        this.handleVideoPlayback(video, photoImage);
        
        fg.appendChild(video);
        
        // No effects or EXIF for videos.
        photoImage.effect = "video";

      } else {
        // --- IMAGE LOGIC (existing code) ---
        const img = document.createElement("img");
        img.id = "mmm-images-photos";
        img.style.maxWidth = this.config.maxWidth;
        img.style.maxHeight = this.config.maxHeight;
        img.style.opacity = this.config.opacity;
        
        let finalEffect = "";
        let isFaceZoom = false;

        if (this.config.faceDetection && this.config.imageEffects.includes("ip-face-zoom") && photoImage.face && photoImage.face.faces && photoImage.face.faces.length > 0) {
          if (Math.random() < 0.4) {
            isFaceZoom = true;
          }
        }
        
        if (isFaceZoom) {
          const faces = photoImage.face.faces;
          const face = faces[Math.floor(Math.random() * faces.length)];
          const zoomIn = Math.random() < 0.5;
          if (zoomIn) {
            const fx_perc = (face.x + face.w / 2) / photoImage.face.width;
            const fy_perc = (face.y + face.h / 2) / photoImage.face.height;
            const S = 1.15;
            const fx = fx_perc - 0.5;
            const fy = fy_perc - 0.5;
            const Dx = 0;
            const Dy = 0.3 - 0.5;
            let Tx = (Dx - S * fx) * 100;
            let Ty = (Dy - S * fy) * 100;
            Tx = Math.max(-15, Math.min(15, Tx));
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
          } else {
            const fx_perc = (face.x + face.w / 2) / photoImage.face.width;
            const fy_perc = (face.y + face.h / 2) / photoImage.face.height;
            img.style.transformOrigin = `${fx_perc * 100}% ${fy_perc * 100}%`;
            img.className = "bgimage mmip-bgimage ip-face-zoom-out";
            finalEffect = `ip-face-zoom-out`;
            const randomDuration = (20 + Math.random() * 20).toFixed(2) + 's';
            img.style.animationDuration = randomDuration;
          }
        } else {
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
        
        Log.info(`[MMM-ImagesPhotos] Applying effect: ${finalEffect} to ${photoImage.url}`);
        photoImage.effect = finalEffect;

        img.onerror = (evt) => {
          Log.error("MMM-ImagesPhotos image load failed", evt.currentTarget.src);
          setTimeout(() => self.updateDom(), self.config.retryDelay);
        };
        img.onload = (evt) => {
          try { self.animateTransition(evt.currentTarget, wrapper); } catch (e) { Log.warn(self.name, e); }
        };

        try { img.crossOrigin = 'Anonymous'; } catch (e) {}
        
        fg.appendChild(img);
        img.src = photoImage.url;

        if (this.config.showExif && photoImage.exif && photoImage.exif.tags) {
          const exifWrapper = this.createExifWrapper(photoImage);
          if (exifWrapper) fg.appendChild(exifWrapper);
        }
      }

      const qrNode = this.createQrCodeNode();
      if (qrNode) fg.appendChild(qrNode);

    }
    return wrapper;
  },

  createExifWrapper(photoImage) {
      if (!this.config.showExif || !photoImage.exif || !photoImage.exif.tags) return null;
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
          return exifWrapper;
      }
      return null;
  },

  getDomFS() {
    const self = this;
    if (this.wrapper === null) {
      this.wrapper = document.createElement("div");
      this.bk = document.createElement("div");
      this.bk.className = "bgimagefs";
      this.wrapper.appendChild(this.bk);
      this.fg = document.createElement("div");
      this.fg.className = "mmip-foreground";
      this.wrapper.appendChild(this.fg);
    }
    
    if (this.config.fill === true) {
      this.bk.style.filter = `blur(${this.config.blur}px)`;
      this.bk.style["-webkit-filter"] = `blur(${this.config.blur}px)`;
    } else {
      this.bk.style.backgroundColor = "black";
    }

    if (this.photos.length) {
      const photoImage = this.currentPhoto;
      if (photoImage) {
        while (self.fg.firstChild) {
          self.fg.removeChild(self.fg.firstChild);
        }
        self.fg.style.opacity = 0;

        // --- Fade In Transition ---
        const blackDuration = this.transitionDefaults.blackDuration;
        const fadeDuration = this.transitionDefaults.fadeDuration;
        setTimeout(() => {
          self.fg.style.transition = `opacity ${fadeDuration}ms ease-in-out`;
          self.fg.style.opacity = 1;
        }, blackDuration);
        // --- End Fade In ---

        if (this.isVideo(photoImage)) {
          // --- VIDEO LOGIC (FS) ---
          const video = document.createElement("video");
          video.className = "mmip-video"; // Use the new video class
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;
          video.setAttribute("playsinline", "true");
          video.preload = "auto";
          video.style.opacity = this.config.opacity;

          this.handleVideoPlayback(video, photoImage);
          
          this.fg.appendChild(video);
          photoImage.effect = "video-fs";

          if (this.config.fill === true) {
            this.bk.style.backgroundImage = ``;
            this.bk.style.backgroundColor = "black";
          }

        } else {
          // --- IMAGE LOGIC (FS - existing code) ---
          const img = document.createElement("img");
          
          let finalEffect = "";
          let isFaceZoom = false;

          if (this.config.faceDetection && this.config.imageEffects.includes("ip-face-zoom") && photoImage.face && photoImage.face.faces && photoImage.face.faces.length > 0) {
            if (Math.random() < 0.4) {
              isFaceZoom = true;
            }
          }
      
          if (isFaceZoom) {
            // Face zoom logic here... (same as before)
          } else {
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
          
          Log.info(`[MMM-ImagesPhotos] Applying effect: ${finalEffect} to ${photoImage.url}`);
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
            
            try { self.animateTransition(eventImage, self.bk); } catch (e) { Log.warn(self.name, e); }
          };

          try { img.crossOrigin = 'Anonymous'; } catch (e) {}
          
          img.src = photoImage.url;
          this.fg.appendChild(img);

          if (this.config.showExif && photoImage.exif && photoImage.exif.tags) {
              const exifWrapper = this.createExifWrapper(photoImage);
              if (exifWrapper) this.fg.appendChild(exifWrapper);
          }
        }
        
        const qrNode = this.createQrCodeNode();
        if (qrNode) this.fg.appendChild(qrNode);
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