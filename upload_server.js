const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const port = 8999; // 스마트폰에서 접속할 포트 번호 (MagicMirror 기본 포트와 충돌 방지를 위해 8999로 변경)

app.use(express.urlencoded({ extended: true })); // 폼 데이터 파싱을 위해 추가

// 사진이 저장될 폴더 지정 (원하는 폴더명으로 변경 가능, 예: 'uploads/Mobile')
const baseFolderName = 'uploads'; 
const uploadDir = path.join(__dirname, baseFolderName);

// 정적 파일 제공 (웹 브라우저에서 사진을 볼 수 있도록 설정)
app.use('/uploads', express.static(uploadDir));

const subFolderName = 'mobileUpload'; // 스마트폰에서 올린 사진이 모일 하위 폴더
const baseMobileUploadDir = path.join(uploadDir, subFolderName);

// 업로드할 기본 폴더가 없으면 자동으로 생성
if (!fs.existsSync(baseMobileUploadDir)) {
    fs.mkdirSync(baseMobileUploadDir, { recursive: true });
    console.log(`✅ [${baseFolderName}/${subFolderName}] 폴더가 생성되었습니다.`);
}

// 파일 업로드 설정
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const yearMonthFolder = `${year}-${month}`;
        
        const normalPath = path.join(baseMobileUploadDir, yearMonthFolder);
        const hiddenPath = path.join(baseMobileUploadDir, '!' + yearMonthFolder);
        
        let targetPath;

        // 숨겨진 폴더가 있는지 먼저 확인
        if (fs.existsSync(hiddenPath)) {
            targetPath = hiddenPath;
        } else if (fs.existsSync(normalPath)) {
            targetPath = normalPath;
        } else {
            // 둘 다 없으면 일반 경로로 새로 생성
            targetPath = normalPath;
        }

        // 최종 경로에 폴더가 없으면 생성 (fs.mkdir은 폴더가 있어도 에러를 내지 않음)
        fs.mkdir(targetPath, { recursive: true }, (err) => {
            if (err) {
                console.error('월별 폴더 생성 또는 확인 실패:', err);
                return cb(err);
            }
            cb(null, targetPath);
        });
    },
    filename: function (req, file, cb) {
        // 파일명 중복을 피하기 위해 현재 시간을 앞에 추가
        cb(null, Date.now() + '_' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 스마트폰에서 접속할 때 보여줄 웹페이지 (모바일 친화적 디자인)
app.get('/', (req, res) => {
    // 업로드 폴더 내의 하위 폴더 목록 읽기 (재귀 탐색)
    function getDirectories(dir, relativePath = '') {
        let results = [];
        if (!fs.existsSync(dir)) return results;
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
                results.push(itemRelativePath);
                results = results.concat(getDirectories(fullPath, itemRelativePath));
            }
        }
        return results;
    }

    const folders = getDirectories(uploadDir);

    // 폴더 관리 UI HTML 조립
    let folderListHtml = '';
    if (folders.length > 0) {
        folderListHtml = `
            <div class="container" style="margin-top: 20px;">
                <h2>📁 사진 폴더 관리</h2>
                <p style="color: #666; font-size: 14px;">폴더별로 매직미러에 표시할지 설정하세요.</p>
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <form action="/show-all-folders" method="post" style="margin: 0; flex: 1;">
                        <button type="submit" class="toolbar-btn show-all-btn">전체 보이기</button>
                    </form>
                    <form action="/hide-all-folders" method="post" style="margin: 0; flex: 1;">
                        <button type="submit" class="toolbar-btn hide-all-btn">전체 숨기기</button>
                    </form>
                </div>
                <ul class="folder-list">
                    ${folders.map(folder => {
                        const baseName = path.basename(folder);
                        const isHidden = baseName.startsWith('!'); 
                        const displayName = baseName.replace(/^!/, '');
                        const depth = folder.split(path.sep).length - 1;
                        const paddingLeft = depth * 25;
                        const clientPath = folder.split(path.sep).join('/');
                        const hasChildren = folders.some(f => f !== folder && f.startsWith(folder + path.sep));
                        const safeClientPath = clientPath.replace(/'/g, "\\'");

                        return `
                            <li class="folder-item ${isHidden ? 'is-hidden' : ''}" data-path="${clientPath}" style="padding-left: ${paddingLeft}px;">
                                <div class="folder-info">
                                    ${hasChildren ? `<span class="toggle-icon" onclick="toggleFolder('${safeClientPath}', this)">▼</span>` : `<span class="toggle-icon"></span>`}
                                    <a class="folder-link" href="/manage-photos?folderName=${encodeURIComponent(folder)}">
                                        <span class="folder-icon">📁</span>
                                        <span class="folder-name">${displayName}</span>
                                    </a>
                                </div>
                                <div class="folder-actions">
                                    <form action="/toggle-folder" method="post" style="margin: 0;">
                                        <input type="hidden" name="folderName" value="${folder}">
                                        <button type="submit" class="action-btn toggle-btn ${isHidden ? 'show-btn' : 'hide-btn'}">
                                            ${isHidden ? '보이기' : '숨기기'}
                                        </button>
                                    </form>
                                </div>
                            </li>
                        `;
                    }).join('')}
                </ul>
            </div>
        `;
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>매직미러 사진 올리기</title>
            <style>
                /* General styles */
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; text-align: center; padding: 20px; background-color: #f4f4f9; }
                .container { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
                h2 { color: #333; margin-bottom: 20px; margin-top: 0; }
                input[type="file"] { margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 5px; width: 80%; background: #fafafa; }
                
                /* Upload Button */
                .upload-btn { padding: 15px 30px; font-size: 18px; background: #007BFF; color: white; border: none; border-radius: 10px; font-weight: bold; width: 100%; cursor: pointer; transition: background-color 0.2s; }
                .upload-btn:hover { background: #0056b3; }

                /* Toolbar buttons */
                .toolbar-btn { padding: 12px; font-size: 14px; color: white; border: none; border-radius: 8px; width: 100%; cursor: pointer; font-weight: 500; transition: background-color 0.2s; }
                .show-all-btn { background: #28a745; }
                .show-all-btn:hover { background: #218838; }
                .hide-all-btn { background: #fd7e14; }
                .hide-all-btn:hover { background: #e06200; }

                /* Folder List */
                .folder-list { list-style: none; padding: 0; text-align: left; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin-top: 20px;}
                .folder-item { border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; transition: background-color 0.2s ease; padding-right: 15px; }
                .folder-item:last-child { border-bottom: none; }
                .folder-item:hover { background-color: #f0f7ff; }
                
                .folder-item.is-hidden .folder-name { color: #999; text-decoration: line-through; font-weight: normal; }
                .folder-item.is-hidden .folder-icon { opacity: 0.5; }
                
                .folder-info { display: flex; align-items: center; gap: 8px; padding: 12px 0 12px 15px; }
                .folder-name { font-size: 16px; font-weight: 500; color: #333; }
                .folder-icon { color: #5dade2; }

                .folder-link {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    text-decoration: none;
                    color: inherit;
                }
                .folder-item:hover .folder-name {
                    text-decoration: underline;
                }

                .toggle-icon { cursor: pointer; display: inline-flex; justify-content: center; align-items: center; width: 20px; height: 20px; font-size: 12px; color: #777; user-select: none; border-radius: 4px; }
                .toggle-icon:hover { background-color: #e9e9e9; }
                .folder-actions { display: flex; gap: 8px; }

                /* Action Buttons in list */
                .action-btn { padding: 6px 12px; font-size: 13px; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 500; transition: background-color 0.2s; }
                .manage-btn { background: #007BFF; }
                .manage-btn:hover { background: #0056b3; }
                .toggle-btn.show-btn { background: #28a745; }
                .toggle-btn.show-btn:hover { background: #218838; }
                .toggle-btn.hide-btn { background: #fd7e14; }
                .toggle-btn.hide-btn:hover { background: #e06200; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>📸 매직미러 사진 올리기</h2>
                <form action="/upload" method="post" enctype="multipart/form-data">
                    <p style="color: #666; font-size: 14px;">한 번에 여러 장을 선택할 수 있습니다.</p>
                    <input type="file" name="photos" accept="image/*" multiple required>
                    <button type="submit" class="upload-btn">전송하기 🚀</button>
                </form>
            </div>
            ${folderListHtml}

            <script>
                // 하위 폴더 접기/펼치기 토글 함수
                function toggleFolder(path, element) {
                    const li = element.closest('li');
                    li.classList.toggle('collapsed');
                    const isCollapsed = li.classList.contains('collapsed');
                    element.innerText = isCollapsed ? '▶' : '▼';
                    updateVisibility();
                }

                // 접힌 폴더의 모든 하위 항목을 찾아 숨기는 함수
                function updateVisibility() {
                    const rows = document.querySelectorAll('li[data-path]');
                    const collapsedPaths = Array.from(rows)
                        .filter(r => r.classList.contains('collapsed'))
                        .map(r => r.getAttribute('data-path') + '/');
                    
                    rows.forEach(row => {
                        const path = row.getAttribute('data-path');
                        const isHidden = collapsedPaths.some(cp => path.startsWith(cp));
                        row.style.display = isHidden ? 'none' : 'flex';
                    });
                }
            </script>
        </body>
        </html>
    `);
});

// 업로드 버튼을 눌렀을 때 처리하는 로직
app.post('/upload', upload.array('photos', 50), (req, res) => {
    // 업로드 직후, 이전에 만들었던 한글/공백 정리 파이썬 스크립트 실행
    exec('python3 clean_names.py', (error, stdout, stderr) => {
        // 스크립트 실행 후 매직미러를 즉시 리프레시하기 위해 PM2 재시작 명령 실행
        exec('pm2 restart MagicMirror || pm2 restart mm', (pm2Error) => {
            res.send(`
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <div style="text-align:center; padding:50px; font-family: sans-serif;">
                    <h1 style="color: #4CAF50;">✅ 업로드 성공!</h1>
                    <p>사진이 성공적으로 전송되었습니다.</p>
                    <p>매직미러 화면을 새로고침(재시작) 하고 있습니다... 🔄</p>
                    <br>
                    <a href="/" style="padding: 15px 30px; background: #333; color: white; text-decoration: none; border-radius: 10px; display: inline-block;">새로 올리기</a>
                </div>
            `);
        });
    });
});

// 폴더 보이기/숨기기 상태 변경 로직
app.post('/toggle-folder', (req, res) => {
    const { folderName } = req.body;
    if (!folderName) return res.redirect('/');

    const oldPath = path.join(uploadDir, folderName);
    if (!fs.existsSync(oldPath)) return res.redirect('/');

    const parentDir = path.dirname(oldPath);
    const baseName = path.basename(oldPath);

    let newBaseName = baseName;
    if (baseName.startsWith('!')) {
        newBaseName = baseName.substring(1); // 숨김 기호 제거 (보이기)
    } else {
        newBaseName = '!' + baseName; // 숨김 기호 추가 (숨기기)
    }
    const newPath = path.join(parentDir, newBaseName);

    try {
        fs.renameSync(oldPath, newPath);
    } catch (e) {
        console.error('폴더명 변경 실패:', e);
    }

    // 이름 변경 후 매직미러 리프레시하여 즉시 반영
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

// 하위 폴더까지 일괄 보이기/숨기기를 위한 재귀 함수
function renameAllDirectories(dirPath, showAll) {
    if (!fs.existsSync(dirPath)) return;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        if (fs.statSync(fullPath).isDirectory()) {
            // 하위 폴더 먼저 처리 (자식 폴더명 변경이 부모 경로에 영향을 주지 않도록)
            renameAllDirectories(fullPath, showAll);
            
            const isHidden = item.startsWith('!');
            let newItem = item;
            if (showAll && isHidden) {
                newItem = item.substring(1);
            } else if (!showAll && !isHidden) {
                newItem = '!' + item;
            }
            
            if (newItem !== item) {
                try { fs.renameSync(fullPath, path.join(dirPath, newItem)); } 
                catch (e) { console.error('폴더명 일괄 변경 실패:', e); }
            }
        }
    }
}

// 전체 보이기 로직
app.post('/show-all-folders', (req, res) => {
    renameAllDirectories(uploadDir, true);
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

// 전체 숨기기 로직
app.post('/hide-all-folders', (req, res) => {
    renameAllDirectories(uploadDir, false);
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

// 특정 폴더의 사진 목록 보기 라우트
// 특정 폴더의 사진 목록 보기 라우트
app.get('/manage-photos', (req, res) => {
    const folderName = req.query.folderName;
    const sortBy = req.query.sortBy || 'date_desc'; // 기본 정렬: 최신순
    if (!folderName) return res.redirect('/');

    const folderPath = path.join(uploadDir, folderName);
    if (!fs.existsSync(folderPath)) return res.redirect('/');

    const files = fs.readdirSync(folderPath);
    
    const imageFiles = files.map(file => {
        try {
            const filePath = path.join(folderPath, file);
            const stats = fs.statSync(filePath);
            return { name: file, birthtime: stats.birthtime };
        } catch(e) {
            console.error(`파일 상태 정보 읽기 실패 ${file}:`, e);
            return null;
        }
    }).filter(fileInfo => {
        if (!fileInfo) return false;
        const ext = path.extname(fileInfo.name).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });

    // 정렬 로직
    imageFiles.sort((a, b) => {
        switch (sortBy) {
            case 'name_asc':
                return a.name.localeCompare(b.name);
            case 'name_desc':
                return b.name.localeCompare(a.name);
            case 'date_asc':
                return a.birthtime.getTime() - b.birthtime.getTime();
            case 'date_desc':
            default:
                return b.birthtime.getTime() - a.birthtime.getTime();
        }
    });

    let photoListHtml = imageFiles.map(fileInfo => {
        const file = fileInfo.name;
        const isHidden = file.startsWith('!');
        const displayName = isHidden ? file.substring(1) : file;
        const encodedFolder = folderName.split(path.sep).map(p => encodeURIComponent(p)).join('/');
        const encodedFile = encodeURIComponent(file);
        const imageUrl = `/uploads/${encodedFolder}/${encodedFile}`;

        return `
            <div class="photo-card ${isHidden ? 'is-hidden' : ''}">
                <div class="photo-image-container">
                    <img src="${imageUrl}" loading="lazy" alt="${displayName}">
                    ${isHidden ? `<div class="hidden-overlay"><span class="hidden-icon">🙈</span></div>` : ''}
                </div>
                <div class="photo-info">
                    <p class="photo-filename" title="${displayName}">${displayName}</p>
                </div>
                <div class="photo-actions">
                    <form action="/toggle-photo" method="post" style="margin:0;">
                        <input type="hidden" name="folderName" value="${folderName}">
                        <input type="hidden" name="fileName" value="${file}">
                        <button type="submit" class="action-btn toggle-btn ${isHidden ? 'show-btn' : 'hide-btn'}">
                            ${isHidden ? '보이기' : '숨기기'}
                        </button>
                    </form>
                    <form action="/delete-photo" method="post" onsubmit="return confirm('정말 이 사진을 삭제하시겠습니까?');" style="margin:0;">
                        <input type="hidden" name="folderName" value="${folderName}">
                        <input type="hidden" name="fileName" value="${file}">
                        <button type="submit" class="action-btn delete-btn">삭제</button>
                    </form>
                </div>
            </div>
        `;
    }).join('');

    if (imageFiles.length === 0) {
        photoListHtml = '<p class="no-photos-message">이 폴더에는 사진이 없습니다.</p>';
    }

    const displayName = folderName.replace(/!/g, '').split(path.sep).join(' / ');
    
    // 정렬 링크 생성을 위한 헬퍼 함수
    const sortLink = (key, text) => {
        const isActive = sortBy === key;
        const url = `?folderName=${encodeURIComponent(folderName)}&sortBy=${key}`;
        return `<a href="${url}" class="sort-link ${isActive ? 'active' : ''}">${text}</a>`;
    };

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>[${displayName}] 사진 관리</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    background-color: #f4f4f9;
                    margin: 0;
                    padding: 20px;
                }
                .main-container {
                    max-width: 1600px;
                    margin: 0 auto;
                }
                .page-header {
                    background: white;
                    padding: 20px 30px;
                    border-radius: 12px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                    margin-bottom: 25px;
                }
                .header-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 15px;
                }
                .page-title {
                    margin: 0;
                    font-size: 22px;
                    font-weight: 600;
                    word-break: break-all;
                }
                .back-link {
                    padding: 10px 20px;
                    background: #6c757d;
                    color: white;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 500;
                    transition: background-color 0.2s;
                    white-space: nowrap;
                }
                .back-link:hover {
                    background: #5a6268;
                }
                .page-actions {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 20px;
                    padding-top: 20px;
                    margin-top: 20px;
                    border-top: 1px solid #eee;
                }
                .sorting-controls {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                }
                .sorting-controls strong {
                    font-size: 14px;
                    font-weight: 600;
                    color: #333;
                }
                .sort-link {
                    text-decoration: none;
                    color: #007bff;
                    font-size: 14px;
                    padding: 6px 12px;
                    border-radius: 8px;
                    transition: background-color 0.2s, color 0.2s;
                    border: 1px solid #dee2e6;
                }
                .sort-link:hover {
                    background-color: #e9ecef;
                }
                .sort-link.active {
                    background-color: #007bff;
                    color: white;
                    border-color: #007bff;
                }
                .destructive-actions {
                    display: flex;
                    gap: 10px;
                }
                .destructive-btn {
                    padding: 10px 18px;
                    background: #dc3545;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                    font-size: 14px;
                    transition: background-color 0.2s;
                }
                .destructive-btn:hover {
                    background: #c82333;
                }

                .photo-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                    gap: 25px;
                }
                .photo-card {
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                    overflow: hidden;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                    display: flex;
                    flex-direction: column;
                }
                .photo-card:hover {
                    transform: translateY(-5px);
                    box-shadow: 0 8px 20px rgba(0,0,0,0.12);
                }
                .photo-image-container {
                    position: relative;
                    width: 100%;
                    padding-top: 75%; /* 4:3 Aspect Ratio */
                }
                .photo-image-container img {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .hidden-overlay {
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(255, 255, 255, 0.7);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                }
                .hidden-icon {
                    font-size: 40px;
                    opacity: 0.8;
                }
                .photo-info {
                    padding: 12px 15px;
                    flex-grow: 1;
                }
                .photo-filename {
                    font-size: 14px;
                    color: #333;
                    margin: 0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .photo-card.is-hidden .photo-filename {
                    text-decoration: line-through;
                    color: #999;
                }
                .photo-actions {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    padding: 0 15px 15px 15px;
                }
                .action-btn {
                    width: 100%;
                    padding: 9px;
                    font-size: 13px;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: background-color 0.2s, transform 0.1s;
                }
                .action-btn:active {
                    transform: scale(0.97);
                }
                .toggle-btn.show-btn { background: #28a745; }
                .toggle-btn.show-btn:hover { background: #218838; }
                .toggle-btn.hide-btn { background: #fd7e14; }
                .toggle-btn.hide-btn:hover { background: #e06200; }
                .delete-btn { background: #dc3545; }
                .delete-btn:hover { background: #c82333; }
                .no-photos-message {
                    color: #666;
                    padding: 40px;
                    font-size: 16px;
                }
                @media (max-width: 768px) {
                    body { padding: 15px; }
                    .header-top { flex-direction: column; align-items: flex-start; gap: 15px; }
                    .page-actions { flex-direction: column; align-items: stretch; text-align: center; }
                    .destructive-actions { justify-content: center; }
                    .photo-grid {
                        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                        gap: 15px;
                    }
                }
                @media (max-width: 480px) {
                    body { padding: 10px; }
                    .photo-grid {
                        grid-template-columns: repeat(2, 1fr);
                        gap: 12px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="main-container">
                <div class="page-header">
                    <div class="header-top">
                        <h2 class="page-title">🖼️ ${displayName}</h2>
                        <a href="/" class="back-link">⬅️ 뒤로 가기</a>
                    </div>
                    <div class="page-actions">
                         <div class="sorting-controls">
                            <strong>정렬:</strong>
                            ${sortLink('date_desc', '최신순')}
                            ${sortLink('date_asc', '오래된순')}
                            ${sortLink('name_asc', '이름순')}
                        </div>
                        <div class="destructive-actions">
                            <form action="/delete-all-photos" method="post" onsubmit="return confirm('이 폴더의 모든 사진을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.');" style="margin: 0;">
                                <input type="hidden" name="folderName" value="${folderName}">
                                <button type="submit" class="destructive-btn">모든 사진 삭제</button>
                            </form>
                            <form action="/delete-folder" method="post" onsubmit="return confirm('정말 이 폴더와 모든 하위 내용(사진, 하위 폴더)을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다!');" style="margin: 0;">
                                <input type="hidden" name="folderName" value="${folderName}">
                                <button type="submit" class="destructive-btn">폴더 삭제</button>
                            </form>
                        </div>
                    </div>
                </div>
                <div class="photo-grid">
                    ${photoListHtml}
                </div>
            </div>
        </body>
        </html>
    `);
});

// 사진 삭제 라우트
app.post('/delete-photo', (req, res) => {
    const { folderName, fileName } = req.body;
    if (!folderName || !fileName) return res.redirect('/');

    const filePath = path.join(uploadDir, folderName, fileName);
    
    // 경로 조작 방지를 위한 보안 확인 및 파일 존재 여부 확인
    if (filePath.startsWith(uploadDir) && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`🗑️ 파일 삭제됨: ${filePath}`);
        } catch (e) {
            console.error('사진 삭제 실패:', e);
        }
    }

    // 삭제 후 화면 즉시 반영을 위해 매직미러 재시작
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/manage-photos?folderName=' + encodeURIComponent(folderName));
    });
});

// 사진 보이기/숨기기 라우트
app.post('/toggle-photo', (req, res) => {
    const { folderName, fileName } = req.body;
    if (!folderName || !fileName) return res.redirect('/');

    const oldPath = path.join(uploadDir, folderName, fileName);
    if (!fs.existsSync(oldPath)) return res.redirect('/manage-photos?folderName=' + encodeURIComponent(folderName));

    const parentDir = path.dirname(oldPath);
    const baseName = path.basename(oldPath);

    let newBaseName = baseName;
    if (baseName.startsWith('!')) {
        newBaseName = baseName.substring(1); // 숨김 기호 제거 (보이기)
    } else {
        newBaseName = '!' + baseName; // 숨김 기호 추가 (숨기기)
    }
    const newPath = path.join(parentDir, newBaseName);

    try {
        fs.renameSync(oldPath, newPath);
    } catch (e) {
        console.error('사진 상태 변경 실패:', e);
    }

    // 이름 변경 후 매직미러 재시작 (화면에 즉시 반영)
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/manage-photos?folderName=' + encodeURIComponent(folderName));
    });
});

// 모든 사진 삭제 라우트
app.post('/delete-all-photos', (req, res) => {
    const { folderName } = req.body;
    if (!folderName) return res.redirect('/');

    const folderPath = path.join(uploadDir, folderName);
    
    // 경로 조작 방지를 위한 보안 확인
    if (folderPath.startsWith(uploadDir) && fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath);
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        
        files.forEach(file => {
            const filePath = path.join(folderPath, file);
            if (imageExtensions.includes(path.extname(file).toLowerCase())) {
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error(`사진 삭제 실패: ${filePath}`, e);
                }
            }
        });
        console.log(`🗑️ 폴더의 모든 사진 삭제됨: ${folderPath}`);
    }

    // 삭제 후 화면 즉시 반영을 위해 매직미러 재시작
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/manage-photos?folderName=' + encodeURIComponent(folderName));
    });
});

// 폴더 삭제 라우트
app.post('/delete-folder', (req, res) => {
    const { folderName } = req.body;

    if (!folderName) {
        return res.status(400).send('폴더 이름이 필요합니다.');
    }
    
    const folderPath = path.join(uploadDir, folderName);

    // 보안: 기본 폴더들 삭제 방지
    if (folderPath === uploadDir || folderPath === baseMobileUploadDir) {
        console.warn(`보호된 폴더 삭제 시도: ${folderPath}`);
        return res.status(403).send('기본 폴더는 삭제할 수 없습니다.');
    }

    // 보안: 최종적으로 경로가 uploads 폴더 내에 있는지 확인
    if (!folderPath.startsWith(uploadDir + path.sep)) {
         console.warn(`허용되지 않은 경로의 폴더 삭제 시도: ${folderPath}`);
        return res.status(403).send('허용되지 않은 경로입니다.');
    }

    if (fs.existsSync(folderPath)) {
        try {
            fs.rmSync(folderPath, { recursive: true, force: true });
            console.log(`🗑️ 폴더 삭제됨: ${folderPath}`);
        } catch (e) {
            console.error(`폴더 삭제 실패: ${folderPath}`, e);
        }
    }

    // 삭제 후 매직미러 리프레시 및 메인 페이지로 리디렉션
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

app.listen(port, () => {
    console.log(`✅ 업로드 서버가 ${port} 포트에서 실행 중입니다.`);
});
