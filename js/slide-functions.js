// スライド表示用のJavaScript関数

function getFrameElement() {
    return document.getElementById('pdf-container');
}

function getIframeElement() {
    const frame = getFrameElement();
    if (!frame) return null;
    if (frame.tagName && frame.tagName.toLowerCase() === 'iframe') {
        return frame;
    }
    return frame.querySelector('iframe');
}

// フルスクリーン表示の切り替え
function toggleExpanded() {
    const frame = getFrameElement();
    if (!frame) return;

    const iframe = getIframeElement();
    const controls = document.querySelector('.pdf-controls');
    const fullscreenBtn = document.querySelector('.fullscreen-btn');
    const icon = fullscreenBtn ? fullscreenBtn.querySelector('i') : null;

    if (!controls || !fullscreenBtn || !icon) {
        return;
    }

    if (!frame.classList.contains('expanded')) {
        // 画面全体表示に切り替え
        frame.classList.add('expanded');
        controls.classList.add('expanded');

        // スライド情報と戻るリンクを非表示
        const slideInfo = document.querySelector('.slide-info');
        const slideContent = document.querySelector('.slide-content');
        const backLink = document.querySelector('.back-link');
        if (slideInfo) slideInfo.classList.add('expanded');
        if (slideContent) slideContent.classList.add('expanded');
        if (backLink) backLink.classList.add('expanded');

        // 画面サイズに応じて適切なサイズを設定
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const aspectRatio = window.slideConfig.maxWidth / window.slideConfig.maxHeight;

        // アスペクト比を保ちながら画面に完全に収まるサイズを計算
        let calculatedWidth;
        let calculatedHeight;

        if (viewportWidth / aspectRatio <= viewportHeight) {
            // 横幅基準で画面に収まる場合
            calculatedWidth = viewportWidth;
            calculatedHeight = viewportWidth / aspectRatio;
        } else {
            // 縦幅基準で画面に収まる場合
            calculatedHeight = viewportHeight;
            calculatedWidth = viewportHeight * aspectRatio;
        }

        frame.style.width = calculatedWidth + 'px';
        frame.style.height = calculatedHeight + 'px';
        if (iframe) {
            iframe.style.width = '100%';
            iframe.style.height = '100%';
        }

        icon.className = 'fa-solid fa-compress';
        fullscreenBtn.innerHTML = '<i class="fa-solid fa-compress"></i>';
    } else {
        // 通常表示に戻す
        frame.classList.remove('expanded');
        controls.classList.remove('expanded');

        // スライド情報と戻るリンクを再表示
        const slideInfo = document.querySelector('.slide-info');
        const slideContent = document.querySelector('.slide-content');
        const backLink = document.querySelector('.back-link');
        if (slideInfo) slideInfo.classList.remove('expanded');
        if (slideContent) slideContent.classList.remove('expanded');
        if (backLink) backLink.classList.remove('expanded');

        frame.style.removeProperty('width');
        frame.style.removeProperty('height');
        if (iframe) {
            iframe.style.removeProperty('width');
            iframe.style.removeProperty('height');
        }
        icon.className = 'fa-solid fa-expand';
        fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
    }
}

// ファイル名から拡張子を取り除く関数
function base(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

// 現在のページ番号を取得する関数
function getCurrentPageNumber() {
    try {
        const iframe = getIframeElement();
        if (!iframe) return 1;
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

        // #pdf-container の data-page 属性からページ番号を取得
        const pdfContainer = iframeDoc.getElementById('pdf-container');
        if (pdfContainer && pdfContainer.dataset.page) {
            const pageNumber = parseInt(pdfContainer.dataset.page, 10);
            if (!isNaN(pageNumber) && pageNumber > 0) {
                return pageNumber;
            }
        }

        // デフォルトは1ページ目
        return 1;
    } catch (error) {
        console.error('ページ番号の取得に失敗しました:', error);
        return 1;
    }
}

// ページ変更を監視する関数
function watchPageChanges() {
    const iframe = getIframeElement();
    if (!iframe) return;

    const setupObservers = () => {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc) return;

            // MutationObserverでページ変更を監視
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' || mutation.type === 'attributes') {
                        // ページ変更を検知したら、ボタンのファイル名を更新
                        updateButtonFilenames();
                    }
                });
            });

            // #pdf-container の data-page 属性の変更を監視
            const pdfContainer = iframeDoc.getElementById('pdf-container');
            if (pdfContainer) {
                observer.observe(pdfContainer, {
                    attributes: true,
                    attributeFilter: ['data-page']
                });
            }

            // ページ要素の変更を監視
            observer.observe(iframeDoc.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });

            // キーボードイベントでページ変更を監視
            iframeDoc.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
                    event.key === 'PageUp' || event.key === 'PageDown') {
                    // 少し遅延させてからファイル名を更新（PDF.jsの処理完了を待つ）
                    setTimeout(updateButtonFilenames, 100);
                }
            });

            // クリックイベントでページ変更を監視
            iframeDoc.addEventListener('click', (event) => {
                // ナビゲーションボタンのクリックを検知
                if (event.target.closest('.navButton, .pageButton, [class*="nav"], [class*="page"]')) {
                    setTimeout(updateButtonFilenames, 100);
                }
            });
        } catch (error) {
            console.error('ページ変更監視の設定に失敗しました:', error);
        }
    };

    if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        setupObservers();
    } else {
        iframe.addEventListener('load', setupObservers, { once: true });
    }
}

// ボタンのファイル名を更新する関数
function updateButtonFilenames() {
    const downloadBtn = document.querySelector('.download-image-btn');
    const copyBtn = document.querySelector('.copy-image-btn');

    if (downloadBtn && copyBtn) {
        const slideDownload = window.slideConfig.download;
        const baseName = base(slideDownload);
        const pageNumber = getCurrentPageNumber();
        const filename = baseName + '-' + pageNumber + '.png';

        // ボタンのツールチップを更新（現在のページ番号を明確に表示）
        downloadBtn.title = 'Save page ' + pageNumber + ' as: ' + filename;
        copyBtn.title = 'Copy page ' + pageNumber + ' as: ' + filename;

        // コンソールに現在のページ番号を表示（デバッグ用）
        console.log('Current page:', pageNumber, 'Filename:', filename);
    }
}

// 現在の表示を画像としてダウンロード
function downloadCanvasAsImage() {
    try {
        const iframe = getIframeElement();
        if (!iframe) {
            throw new Error('iframe element is not available');
        }
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

        // iframe内のcanvas要素を探す
        const canvas = iframeDoc.querySelector('canvas');

        if (canvas) {
            // ファイル名を生成
            const slideDownload = window.slideConfig.download;
            const baseName = base(slideDownload);
            const pageNumber = getCurrentPageNumber();
            const filename = baseName + '-' + pageNumber + '.png';

            // canvasを画像に変換
            const dataURL = canvas.toDataURL('image/png');

            // ダウンロードリンクを作成
            const link = document.createElement('a');
            link.download = filename;
            link.href = dataURL;

            // クリックしてダウンロード
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            // canvasが見つからない場合の代替手段
            // html2canvas(iframe) は外部ライブラリが必要
            alert('画像のダウンロードに失敗しました。iframe内のcanvas要素が見つからないか、同一オリジンポリシーによりアクセスできません。');
        }
    } catch (error) {
        console.error('画像ダウンロードに失敗しました:', error);
        alert('画像のダウンロードに失敗しました。iframe内のコンテンツにアクセスできません。');
    }
}

// 現在の表示をクリップボードにコピー
async function copyCanvasToClipboard() {
    try {
        const iframe = getIframeElement();
        if (!iframe) {
            throw new Error('iframe element is not available');
        }
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

        // iframe内のcanvas要素を探す
        const canvas = iframeDoc.querySelector('canvas');

        if (canvas) {
            // canvasをBlobに変換
            canvas.toBlob(async (blob) => {
                try {
                    // クリップボードに画像をコピー
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            'image/png': blob
                        })
                    ]);
                    showToast('画像がクリップボードにコピーされました！', 'success');
                } catch (clipboardError) {
                    console.error('クリップボードへのコピーに失敗しました:', clipboardError);
                    showToast('クリップボードへのコピーに失敗しました。ブラウザが対応していない可能性があります。', 'error');
                }
            }, 'image/png');
        } else {
            // canvasが見つからない場合の代替手段
            // html2canvas(iframe) は外部ライブラリが必要
            showToast('画像のクリップボードコピーに失敗しました。iframe内のcanvas要素が見つからないか、同一オリジンポリシーによりアクセスできません。', 'error');
        }
    } catch (error) {
        console.error('画像のクリップボードコピーに失敗しました:', error);
        showToast('画像のクリップボードコピーに失敗しました。iframe内のコンテンツにアクセスできません。', 'error');
    }
}

// Toast通知を表示する関数
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast ' + type;

    // 表示
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    // 3秒後に自動で非表示
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ウィンドウリサイズ時にサイズを再調整
function handleResize() {
    const frame = getFrameElement();
    if (!frame || !frame.classList.contains('expanded')) return;

    const iframe = getIframeElement();

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const aspectRatio = window.slideConfig.maxWidth / window.slideConfig.maxHeight;

    let calculatedWidth;
    let calculatedHeight;

    if (viewportWidth / aspectRatio <= viewportHeight) {
        calculatedWidth = viewportWidth;
        calculatedHeight = viewportWidth / aspectRatio;
    } else {
        calculatedHeight = viewportHeight;
        calculatedWidth = viewportHeight * aspectRatio;
    }

    frame.style.width = calculatedWidth + 'px';
    frame.style.height = calculatedHeight + 'px';
    if (iframe) {
        iframe.style.width = '100%';
        iframe.style.height = '100%';
    }
}

// 初期化関数
function initializeSlide() {
    // ウィンドウリサイズイベントを設定
    window.addEventListener('resize', handleResize);

    // Full screen APIのイベントリスナーを追加
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // ページ変更監視を開始（iframe読み込み完了後）
    document.addEventListener('DOMContentLoaded', () => {
        watchPageChanges();
    });
}

// Full screen APIの状態変化を監視
function handleFullscreenChange() {
    const frame = getFrameElement();
    if (!frame) return;

    if (!document.fullscreenElement &&
        !document.webkitFullscreenElement &&
        !document.mozFullScreenElement &&
        !document.msFullscreenElement) {
        // 全画面表示が解除された場合
        resetFullscreenSize();
    }
}

// Full screen APIを使った全画面表示の切り替え
function toggleFullscreen() {
    const frame = getFrameElement();
    if (!frame) return;

    const isFullscreen = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    if (!isFullscreen) {
        // 全画面表示に切り替え
        const requestFullscreen = frame.requestFullscreen ||
            frame.webkitRequestFullscreen ||
            frame.mozRequestFullScreen ||
            frame.msRequestFullscreen;

        if (requestFullscreen) {
            const result = requestFullscreen.call(frame);
            if (result && typeof result.then === 'function') {
                result.then(() => {
                    setTimeout(adjustFullscreenSize, 100);
                }).catch((err) => {
                    console.error('全画面表示に失敗しました:', err);
                    showToast('全画面表示に失敗しました。ブラウザが対応していない可能性があります。', 'error');
                });
            } else {
                setTimeout(adjustFullscreenSize, 100);
            }
        }
    } else {
        // 全画面表示を解除
        const exitFullscreen = document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.mozCancelFullScreen ||
            document.msExitFullscreen;

        if (exitFullscreen) {
            const result = exitFullscreen.call(document);
            if (result && typeof result.then === 'function') {
                result.then(() => {
                    resetFullscreenSize();
                }).catch((err) => {
                    console.error('全画面表示の解除に失敗しました:', err);
                });
            } else {
                resetFullscreenSize();
            }
        }
    }
}

// 全画面表示時のサイズ調整
function adjustFullscreenSize() {
    const frame = getFrameElement();
    if (!frame) return;

    // CSSの:fullscreen擬似クラスでサイズ制限を行うため、
    // JavaScriptでのサイズ調整は最小限にする
    console.log('Fullscreen mode activated - CSS :fullscreen pseudo-class will handle sizing');
}

// 全画面表示解除時のサイズリセット
function resetFullscreenSize() {
    const frame = getFrameElement();
    if (!frame) return;

    frame.style.removeProperty('width');
    frame.style.removeProperty('height');
    frame.style.removeProperty('position');
    frame.style.removeProperty('top');
    frame.style.removeProperty('left');
    frame.style.removeProperty('transform');
    frame.style.removeProperty('z-index');

    const iframe = getIframeElement();
    if (iframe) {
        iframe.style.removeProperty('width');
        iframe.style.removeProperty('height');
    }

    // 少し遅延させてからCSSの再適用を確実にする
    setTimeout(() => {
        frame.style.display = 'none';
        frame.offsetHeight; // 強制的に再描画を発生させる
        frame.style.display = '';
    }, 10);
}

// Web Share APIを使ったスライド共有
function shareSlide() {
    if (navigator.share) {
        navigator.share({
            title: document.title,
            text: 'このスライドをチェックしてください！',
            url: window.location.href
        }).catch(err => {
            console.error('共有に失敗しました:', err);
            showToast('共有に失敗しました。', 'error');
        });
    } else {
        // Web Share APIがサポートされていない場合
        showToast('Web Share APIがサポートされていません。', 'error');
    }
}

// グローバルスコープに関数を公開
window.toggleExpanded = toggleExpanded;
window.toggleFullscreen = toggleFullscreen;
window.shareSlide = shareSlide;
window.downloadCanvasAsImage = downloadCanvasAsImage;
window.copyCanvasToClipboard = copyCanvasToClipboard;
window.initializeSlide = initializeSlide;
