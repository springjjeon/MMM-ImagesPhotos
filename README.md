# MMM-ImagesPhotos

This is a module for the [MagicMirror²](https://github.com/MichMich/MagicMirror). It displays photos from a local directory with smooth transitions and optional face detection-based animations.

![Demo](.github/animate.gif)

## Installation

1.  Navigate to your MagicMirror's `modules` folder.
2.  Clone this repository:
    ```bash
    git clone https://github.com/sdetweil/MMM-ImagesPhotos.git
    ```
3.  Go into the newly created directory and install the dependencies:
    ```bash
    cd MMM-ImagesPhotos
    npm install
    ```

### Face Detection (Optional)

This module can use face detection to apply intelligent pan and zoom animations to your photos (a "Ken Burns" effect). To enable this, you need to set up the Python environment.

1.  **Install Python dependencies:**
    The face detection script requires `numpy` and `opencv-python`. Install them using `pip`:
    ```bash
    pip install numpy opencv-python
    ```

2.  **Configure the Haar Cascade file:**
    The Python script `faceDetection/faceDetection.py` needs a path to a model file for detecting faces. The script currently has a hardcoded path that will likely not work on your system.

    You must edit `faceDetection/faceDetection.py` and provide the correct path to `haarcascade_frontalface_default.xml`.

    *   You can find this file in the OpenCV library you installed. Search for it on your system.
    *   For example, on a Raspberry Pi with OpenCV installed, it might be located at `/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml`.

    Open `faceDetection/faceDetection.py` and change this line to the correct path on your system:
    ```python
    # Line 5 in faceDetection/faceDetection.py
    faceCascade = cv2.CascadeClassifier('/home/pi/opencv/opencv-4.5.0/data/haarcascades/haarcascade_frontalface_default.xml')
    ```

## Using the module

Add the following configuration to the `modules` array in your `config/config.js` file.

### Basic Configuration Example

```javascript
{
    module: "MMM-ImagesPhotos",
    position: "fullscreen_below",
    config: {
        path: "uploads/",
        updateInterval: 60000,
        animationSpeed: 1000,
        showExif: true,
        faceDetection: true
    }
},
```

### Configuration Options

| Option | Description | Default |
| --- | --- | --- |
| `path` | Path to the directory containing your images. If empty, it defaults to the `uploads` folder inside the module directory. | `""` |
| `updateInterval` | How often to change the image (in milliseconds). | `5000` |
| `getInterval` | How often to rescan the image directory for new files (in milliseconds). | `60000` |
| `animationSpeed` | The duration of the fade-in/fade-out transitions (in milliseconds). | `500` |
| `opacity` | The opacity of the displayed image. | `0.9` |
| `sequential` | If `true`, images are displayed in alphabetical order. If `false`, they are displayed randomly. | `false` |
| `showExif` | If `true`, displays an overlay with photo metadata like date, camera model, exposure, and GPS location (if available). | `true` |
| `faceDetection` | If `true`, enables the face detection pan-and-zoom effect. Requires Python setup (see above). | `true` |
| `maxWidth` | Maximum width of the image (e.g., "500px" or "50%"). Used in non-fullscreen mode. | `"100%"` |
| `maxHeight` | Maximum height of the image (e.g., "500px" or "50%"). Used in non-fullscreen mode. | `"100%"` |
| `fill` | **Fullscreen only.** If `true`, the background is filled with a blurred version of the image. | `false` |
| `blur` | **Fullscreen only.** The amount of blur to apply to the background when `fill` is `true`. | `8` |
| `backgroundColor` | **Fullscreen only.** Background color to show behind the image if `fill` is `false`. | `"black"` |
| `imageEffects` | An array of animation effects to apply to the images. See the list of available effects below. | `["ip-zoom", ...]` |
| `debugToConsole` | If `true`, prints detailed logs to the browser console and terminal for debugging. | `true` |

#### Transition Timing

You can fine-tune the display sequence with these settings (all in milliseconds):

| Option | Description | Default |
| --- | --- | --- |
| `blackDuration` | Time the screen stays black before a new image fades in. | `1000` |
| `fadeDuration` | Duration of the fade-in and fade-out animations. Overrides `animationSpeed`. | `1000` |
| `displayDuration`| How long the image is shown between fades. Overrides `updateInterval`. | `5000` |
| `transitionEasing`| The CSS easing function for transitions (e.g., `ease-in-out`, `linear`). | `"ease-in-out"` |

#### Available Image Effects (`imageEffects`)

- `ip-still` (no movement)
- `ip-zoom`
- `ip-zoom-panright`
- `ip-zoom-panleft`
- `ip-zoom-panup`
- `ip-zoom-pandown`
- `ip-panright`
- `ip-panleft`
- `ip-panup`
- `ip-pandown`
- `ip-pan-diag-tl-br`
- `ip-pan-diag-tr-bl`
- `ip-pan-diag-bl-tr`
- `ip-pan-diag-br-tl`
- `ip-face-zoom` (requires `faceDetection: true`)

## Changelog

For a list of all notable changes to this module, please see the [CHANGELOG.md](CHANGELOG.md) file.