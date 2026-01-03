import numpy as np
import cv2
import sys
import os

faceCascade = cv2.CascadeClassifier('/home/pi/opencv/opencv-4.5.0/data/haarcascades/haarcascade_frontalface_default.xml')
# image = cv2.imread('/home/pi/MagicMirror/modules/MMM-GooglePhotos/cache/temp.jpg')
image_path = sys.argv[1]
image = cv2.imread(image_path)

# Make a copy for drawing not to impact original image data
image_with_rectangles = image.copy()

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
faces = faceCascade.detectMultiScale(
    gray,
    scaleFactor=1.3,
    minNeighbors=5,
    minSize=(30, 30)
)

# print(f"Face Count : {len(faces)}")  # Uncomment this line if you want to print the face count
# Draw rectangles and save a copy
if len(faces) > 0:
    for (x, y, w, h) in faces:
        cv2.rectangle(image_with_rectangles, (x, y), (x+w, y+h), (0, 0, 255), 2) # Red rectangle in BGR

    dirname = os.path.dirname(image_path)
    basename = os.path.basename(image_path)
    name, ext = os.path.splitext(basename)
    new_filepath = os.path.join(dirname, f"{name}_detected{ext}")
    cv2.imwrite(new_filepath, image_with_rectangles)

# JSON output
json_data = "{ \"count\" : " + str(len(faces)) + ","
json_data += "\"width\" : " + str(image.shape[1]) + ","
json_data += "\"height\" : " + str(image.shape[0]) + ","
json_data += " \"faces\" : ["
i = 0
for (x, y, w, h) in faces:
    if i > 0 :
        json_data += ","
    json_data += "{\"x\" : " + str(x) +", \"y\" :" + str(y) +", \"w\" : " + str(w) +", \"h\" : " + str(h) +"}"
    i += 1

json_data += " ]"
json_data += " }"

# In Python 3, print requires parentheses
print(json_data)

# cv2.imshow("Face", image)
# cv2.waitKey(0)
# cv2.destroyAllWindows()
# cv2.waitKey(1)
