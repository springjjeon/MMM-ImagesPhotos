
const fs = require('fs');
const path = require('path');

// --- Directory Operations ---

const fsAsync = require('fs').promises;

/**
 * Recursively gets all directory paths within a given directory asynchronously.
 * @param {string} dir - The directory to start from.
 * @param {string} [relativePath=''] - The relative path for recursion.
 * @returns {Promise<string[]>} - A promise that resolves to an array of directory paths.
 */
async function getDirectories(dir, relativePath = '') {
    let results = [];
    try {
        await fsAsync.access(dir);
    } catch (e) {
        return results; // Directory doesn't exist or is not accessible
    }

    const items = await fsAsync.readdir(dir, { withFileTypes: true });
    for (const item of items) {
        if (item.isDirectory()) {
            const itemRelativePath = path.join(relativePath, item.name);
            results.push(itemRelativePath);
            const subResults = await getDirectories(path.join(dir, item.name), itemRelativePath);
            results = results.concat(subResults);
        }
    }
    return results;
}

/**
 * Toggles the visibility of a folder by adding/removing a '!' prefix.
 * @param {string} uploadDir - The base uploads directory.
 * @param {string} folderName - The relative path of the folder to toggle.
 */
function toggleFolderVisibility(uploadDir, folderName) {
    if (!folderName) return;

    let oldPath = path.join(uploadDir, folderName);
    if (!fs.existsSync(oldPath)) return;

    const parentDir = path.dirname(oldPath);
    const baseName = path.basename(oldPath);
    const isMakingVisible = baseName.startsWith('!');

    // If making a folder visible, ensure all its parent folders are also made visible.
    if (isMakingVisible) {
        let currentParent = parentDir;
        while (currentParent.startsWith(uploadDir) && currentParent !== uploadDir) {
            const parentBaseName = path.basename(currentParent);
            if (parentBaseName.startsWith('!')) {
                const newParentPath = path.join(path.dirname(currentParent), parentBaseName.substring(1));
                try {
                    fs.renameSync(currentParent, newParentPath);
                } catch (e) {
                    console.error(`Failed to make parent folder visible: ${currentParent}`, e);
                }
                currentParent = path.dirname(newParentPath);
            } else {
                currentParent = path.dirname(currentParent);
            }
        }
    } else {
        // If hiding a folder, hide all its subfolders as well.
        renameAllDirectories(oldPath, false); // Hide all children
    }
    
    const newBaseName = isMakingVisible ? baseName.substring(1) : `!${baseName}`;
    const newPath = path.join(parentDir, newBaseName);

    try {
        fs.renameSync(oldPath, newPath);
    } catch (e) {
        console.error(`Failed to rename folder: ${oldPath}`, e);
    }
}


/**
 * Recursively renames all directories to be shown or hidden.
 * @param {string} dirPath - The starting directory path.
 * @param {boolean} showAll - True to show all (remove '!'), false to hide all (add '!').
 */
function renameAllDirectories(dirPath, showAll) {
    if (!fs.existsSync(dirPath)) return;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        try {
            if (fs.statSync(fullPath).isDirectory()) {
                renameAllDirectories(fullPath, showAll); // Recurse first
                
                const isHidden = item.startsWith('!');
                let newItem = item;
                if (showAll && isHidden) {
                    newItem = item.substring(1);
                } else if (!showAll && !isHidden) {
                    newItem = '!' + item;
                }
                
                if (newItem !== item) {
                    fs.renameSync(fullPath, path.join(dirPath, newItem));
                }
            }
        } catch (e) {
             console.error(`Failed to process directory ${fullPath}:`, e);
        }
    }
}

/**
 * Deletes a folder and all its contents.
 * @param {string} uploadDir - The base uploads directory for security checks.
 * @param {string} folderName - The relative path of the folder to delete.
 */
function deleteFolder(uploadDir, folderName) {
    if (!folderName) return false;

    const folderPath = path.join(uploadDir, folderName);
    
    // Security check: only allow deletion within the upload directory.
    if (!folderPath.startsWith(uploadDir + path.sep)) {
        console.warn(`Attempted to delete folder outside of upload directory: ${folderPath}`);
        return false;
    }

    if (fs.existsSync(folderPath)) {
        try {
            fs.rmSync(folderPath, { recursive: true, force: true });
            console.log(`🗑️ Folder deleted: ${folderPath}`);
            return true;
        } catch (e) {
            console.error(`Failed to delete folder: ${folderPath}`, e);
            return false;
        }
    }
    return false;
}


// --- Photo/File Operations ---

/**
 * Gets a sorted list of media files from a folder.
 * @param {string} folderPath - The full path to the folder.
 * @param {string} sortBy - The sorting key ('date_desc', 'date_asc', 'name_asc').
 * @returns {object[]} - An array of file info objects.
 */
function getMediaFiles(folderPath, sortBy = 'date_desc') {
    if (!fs.existsSync(folderPath)) return [];

    const files = fs.readdirSync(folderPath);
    const mediaFiles = files.map(file => {
        try {
            const filePath = path.join(folderPath, file);
            const stats = fs.statSync(filePath);
            return { name: file, birthtime: stats.birthtime, isFile: stats.isFile() };
        } catch (e) {
            console.error(`Failed to stat file ${file}:`, e);
            return null;
        }
    }).filter(fileInfo => {
        if (!fileInfo || !fileInfo.isFile) return false;
        const ext = path.extname(fileInfo.name).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.ogg', '.mov'].includes(ext);
    });

    // Sort the files
    mediaFiles.sort((a, b) => {
        switch (sortBy) {
            case 'name_asc': return a.name.localeCompare(b.name);
            case 'name_desc': return b.name.localeCompare(a.name);
            case 'date_asc': return a.birthtime.getTime() - b.birthtime.getTime();
            case 'date_desc':
            default: return b.birthtime.getTime() - a.birthtime.getTime();
        }
    });

    return mediaFiles;
}

/**
 * Toggles the visibility of a single photo by adding/removing a '!' prefix.
 * @param {string} uploadDir - The base uploads directory.
 * @param {string} folderName - The folder containing the photo.
 * @param {string} fileName - The name of the photo file.
 */
function togglePhotoVisibility(uploadDir, folderName, fileName) {
    if (!folderName || !fileName) return;

    const oldPath = path.join(uploadDir, folderName, fileName);
    if (!fs.existsSync(oldPath)) return;

    const parentDir = path.dirname(oldPath);
    const baseName = path.basename(oldPath);

    const newBaseName = baseName.startsWith('!') ? baseName.substring(1) : `!${baseName}`;
    const newPath = path.join(parentDir, newBaseName);

    try {
        fs.renameSync(oldPath, newPath);
    } catch (e) {
        console.error(`Failed to rename photo: ${oldPath}`, e);
    }
}

/**
 * Deletes a single photo file.
 * @param {string} uploadDir - The base uploads directory.
 * @param {string} folderName - The folder containing the photo.
 * @param {string} fileName - The name of the photo file.
 */
function deletePhoto(uploadDir, folderName, fileName) {
    if (!folderName || !fileName) return;

    const filePath = path.join(uploadDir, folderName, fileName);
    // Security check and file existence
    if (filePath.startsWith(uploadDir) && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`🗑️ File deleted: ${filePath}`);
        } catch (e) {
            console.error('Failed to delete photo:', e);
        }
    }
}

/**
 * Deletes all photo files within a specific folder.
 * @param {string} uploadDir - The base uploads directory.
 * @param {string} folderName - The folder from which to delete photos.
 */
function deleteAllPhotosInFolder(uploadDir, folderName) {
    const folderPath = path.join(uploadDir, folderName);
    if (!folderPath.startsWith(uploadDir) || !fs.existsSync(folderPath)) return;

    const files = fs.readdirSync(folderPath);
    const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.ogg', '.mov'];
    
    files.forEach(file => {
        const filePath = path.join(folderPath, file);
        if (mediaExtensions.includes(path.extname(file).toLowerCase())) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error(`Failed to delete photo: ${filePath}`, e);
            }
        }
    });
    console.log(`🗑️ All media files deleted from folder: ${folderPath}`);
}

/**
 * Renames all photos in a folder to be shown or hidden.
 * @param {string} folderPath - The full path of the folder.
 * @param {boolean} showAll - True to show all (remove '!'), false to hide all (add '!').
 */
function renameAllPhotosInFolder(folderPath, showAll) {
    if (!fs.existsSync(folderPath)) return;

    const files = fs.readdirSync(folderPath);
    files.forEach(file => {
        const oldPath = path.join(folderPath, file);
        try {
            if (fs.statSync(oldPath).isFile()) {
                const isHidden = file.startsWith('!');
                let newFile = file;

                if (showAll && isHidden) {
                    newFile = file.substring(1);
                } else if (!showAll && !isHidden) {
                    newFile = '!' + file;
                }

                if (newFile !== file) {
                    fs.renameSync(oldPath, path.join(folderPath, newFile));
                }
            }
        } catch (e) {
            console.error(`Failed to process file ${oldPath}:`, e);
        }
    });
}


module.exports = {
    getDirectories,
    toggleFolderVisibility,
    renameAllDirectories,
    deleteFolder,
    getMediaFiles,
    togglePhotoVisibility,
    deletePhoto,
    deleteAllPhotosInFolder,
    renameAllPhotosInFolder,
};
