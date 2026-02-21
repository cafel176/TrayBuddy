// 二次元背景生成器

(function() {
    'use strict';

    // DOM 元素
    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');

    // 控件引用
    const controls = {
        canvasWidth: document.getElementById('canvasWidth'),
        canvasHeight: document.getElementById('canvasHeight'),
        bgColor1: document.getElementById('bgColor1'),
        bgColor2: document.getElementById('bgColor2'),
        enableDiamond: document.getElementById('enableDiamond'),
        diamondLight: document.getElementById('diamondLight'),
        diamondDark: document.getElementById('diamondDark'),
        diamondSize: document.getElementById('diamondSize'),
        diamondOpacity: document.getElementById('diamondOpacity'),
        patternStyle: document.getElementById('patternStyle'),
        enableBorder: document.getElementById('enableBorder'),
        borderColor: document.getElementById('borderColor'),
        borderWidth: document.getElementById('borderWidth'),
        borderPadding: document.getElementById('borderPadding'),
        borderLayers: document.getElementById('borderLayers'),
        borderStyle: document.getElementById('borderStyle'),
        borderCurve: document.getElementById('borderCurve'),
        borderCurveRatio: document.getElementById('borderCurveRatio'),
        borderCornerCut: document.getElementById('borderCornerCut'),
        enableCorners: document.getElementById('enableCorners'),
        enableDifferentCorners: document.getElementById('enableDifferentCorners'),
        cornerStyle: document.getElementById('cornerStyle'),
        cornerStyleTL: document.getElementById('cornerStyleTL'),
        cornerStyleTR: document.getElementById('cornerStyleTR'),
        cornerStyleBL: document.getElementById('cornerStyleBL'),
        cornerStyleBR: document.getElementById('cornerStyleBR'),
        enableCornerRotation: document.getElementById('enableCornerRotation'),
        cornerSize: document.getElementById('cornerSize'),
        cornerColor: document.getElementById('cornerColor'),
        cornerRenderMode: document.getElementById('cornerRenderMode'),
        themeColor: document.getElementById('themeColor'),
        applyTheme: document.getElementById('applyTheme'),
        enableCornerFrame: document.getElementById('enableCornerFrame'),


        cornerFrameSize: document.getElementById('cornerFrameSize'),
        cornerFrameWidth: document.getElementById('cornerFrameWidth'),
        cornerFrameColor: document.getElementById('cornerFrameColor'),
        cornerFrameFill: document.getElementById('cornerFrameFill'),
        enableCornerStroke: document.getElementById('enableCornerStroke'),
        cornerStrokeColor: document.getElementById('cornerStrokeColor'),
        cornerStrokeWidth: document.getElementById('cornerStrokeWidth'),
        enableCornerGlow: document.getElementById('enableCornerGlow'),
        cornerGlowColor: document.getElementById('cornerGlowColor'),
        cornerGlowIntensity: document.getElementById('cornerGlowIntensity'),
        enableCornerShadow: document.getElementById('enableCornerShadow'),
        enableDots: document.getElementById('enableDots'),
        enableCharacter: document.getElementById('enableCharacter'),
        characterImage: document.getElementById('characterImage'),
        characterOpacity: document.getElementById('characterOpacity'),
        characterPosition: document.getElementById('characterPosition'),
        enableGradient: document.getElementById('enableGradient'),
        gradientDirection: document.getElementById('gradientDirection'),
        gradientStart: document.getElementById('gradientStart'),
        gradientEnd: document.getElementById('gradientEnd'),
        gradientIntensity: document.getElementById('gradientIntensity')
    };

    // 角色图片数据
    let characterImageData = null;

    // 初始化
    function init() {
        // 绑定事件
        bindEvents();
        // 初始渲染
        render();
        // 监听语言变化事件
        window.addEventListener('languageChanged', updateI18nElements);
    }

    // 更新 i18n 相关元素（如 optgroup label 和 select option）
    function updateI18nElements() {
        if (!window.i18n || !window.i18n.translations) return;
        const t = window.i18n.translations;
        
        // 更新 optgroup label
        document.querySelectorAll('optgroup[data-i18n-label]').forEach(og => {
            const key = og.getAttribute('data-i18n-label');
            if (t[key]) og.label = t[key];
        });
        
        // 更新 select option
        document.querySelectorAll('option[data-i18n]').forEach(opt => {
            const key = opt.getAttribute('data-i18n');
            if (t[key]) opt.textContent = t[key];
        });
    }


    // 绑定所有事件
    function bindEvents() {
        // 所有输入控件变化时重新渲染
        Object.values(controls).forEach(control => {
            if (control) {
                control.addEventListener('input', () => {
                    updateValueDisplays();
                    render();
                });
                control.addEventListener('change', () => {
                    updateValueDisplays();
                    render();
                });
            }
        });

        // 角色图片上传
        controls.characterImage.addEventListener('change', handleCharacterUpload);

        // 四角不同样式切换
        controls.enableDifferentCorners.addEventListener('change', toggleCornerStyleMode);

        // 导出按钮
        document.getElementById('refreshBtn').addEventListener('click', render);
        document.getElementById('exportPng').addEventListener('click', () => exportImage('png'));
        document.getElementById('exportJpg').addEventListener('click', () => exportImage('jpg'));

        // 一键主题色
        if (controls.applyTheme) {
            controls.applyTheme.addEventListener('click', () => {
                applyThemeFromColor(controls.themeColor.value);
                updateValueDisplays();
                render();
            });
        }

        // 滑块值显示更新
        updateValueDisplays();

    }

    // 切换四角样式模式
    function toggleCornerStyleMode() {
        const unified = document.getElementById('unifiedStyleGroup');
        const different = document.getElementById('differentStyleGroup');
        
        if (controls.enableDifferentCorners.checked) {
            unified.style.display = 'none';
            different.style.display = 'block';
        } else {
            unified.style.display = 'block';
            different.style.display = 'none';
        }
    }

    // 更新滑块值显示
    function updateValueDisplays() {
        document.getElementById('diamondSizeValue').textContent = controls.diamondSize.value;
        document.getElementById('diamondOpacityValue').textContent = controls.diamondOpacity.value + '%';
        document.getElementById('borderWidthValue').textContent = controls.borderWidth.value;
        document.getElementById('borderPaddingValue').textContent = controls.borderPadding.value;
        document.getElementById('borderLayersValue').textContent = controls.borderLayers.value;
        document.getElementById('borderCurveValue').textContent = controls.borderCurve.value;
        document.getElementById('borderCurveRatioValue').textContent = controls.borderCurveRatio.value + '%';
        document.getElementById('borderCornerCutValue').textContent = controls.borderCornerCut.value;
        document.getElementById('cornerSizeValue').textContent = controls.cornerSize.value;
        document.getElementById('cornerFrameSizeValue').textContent = controls.cornerFrameSize.value + '%';
        document.getElementById('cornerFrameWidthValue').textContent = controls.cornerFrameWidth.value;
        document.getElementById('cornerStrokeWidthValue').textContent = controls.cornerStrokeWidth.value;
        document.getElementById('cornerGlowIntensityValue').textContent = controls.cornerGlowIntensity.value + '%';
        document.getElementById('characterOpacityValue').textContent = controls.characterOpacity.value + '%';
        document.getElementById('gradientIntensityValue').textContent = controls.gradientIntensity.value + '%';
        document.getElementById('previewSize').textContent = `${controls.canvasWidth.value} × ${controls.canvasHeight.value}`;
    }

    // 处理角色图片上传
    function handleCharacterUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                characterImageData = img;
                render();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    // 预设尺寸
    window.setPreset = function(width, height) {
        controls.canvasWidth.value = width;
        controls.canvasHeight.value = height;
        updateValueDisplays();
        render();
    };

    // 主渲染函数
    function render() {
        const width = parseInt(controls.canvasWidth.value);
        const height = parseInt(controls.canvasHeight.value);

        canvas.width = width;
        canvas.height = height;

        // 1. 绘制背景色
        drawBackground(width, height);

        // 2. 绘制菱形图案
        if (controls.enableDiamond.checked) {
            drawDiamondPattern(width, height);
        }

        // 3. 绘制角色剪影
        if (controls.enableCharacter.checked && characterImageData) {
            drawCharacter(width, height);
        }

        // 4. 绘制渐变叠加
        if (controls.enableGradient.checked) {
            drawGradientOverlay(width, height);
        }

        // 5. 使用边框路径裁剪背景（遮挡内凹区域外的部分）
        if (controls.enableBorder.checked) {
            clipBackgroundWithBorder(width, height);
        }

        // 6. 绘制边框
        if (controls.enableBorder.checked) {
            drawBorder(width, height);
        }

        // 7. 绘制角落装饰
        if (controls.enableCorners.checked) {
            drawCornerDecorations(width, height);
        }
    }

    // 使用边框路径裁剪背景（填充边框外区域）
    function clipBackgroundWithBorder(width, height) {
        const borderStyle = controls.borderStyle.value;
        const curveAmount = parseInt(controls.borderCurve.value);
        const curveRatio = parseInt(controls.borderCurveRatio.value) / 100;
        const cornerCutBase = parseInt(controls.borderCornerCut.value);
        
        // 获取自适应参数
        const adaptive = getAdaptiveParams();
        const padding = adaptive.padding;
        
        // 使用最外层边框的参数
        const x = padding;
        const y = padding;
        const w = width - padding * 2;
        const h = height - padding * 2;
        const cornerCut = cornerCutBase;
        const curve = curveAmount;

        ctx.save();
        
        // 创建边框路径
        ctx.beginPath();
        
        switch (borderStyle) {
            case 'elegant':
                drawElegantBorder(x, y, w, h, cornerCut, curve, curveRatio);
                break;
            case 'classic':
                drawClassicBorder(x, y, w, h);
                break;
            case 'round':
                drawRoundBorder(x, y, w, h, cornerCut);
                break;
            case 'wave':
                drawWaveBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'scallop':
                drawScallopBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'diamond-cut':
                drawDiamondCutBorder(x, y, w, h, cornerCut);
                break;
            case 'inward-curve':
                drawInwardCurveBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'inward-double':
                drawInwardDoubleBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'inward-corner':
                drawInwardCornerBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'inward-arch':
                drawInwardArchBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'inward-lens':
                drawInwardLensBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'zigzag':
                drawZigzagBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'cloud':
                drawCloudBorder(x, y, w, h, curve);
                break;
            case 'baroque':
                drawBaroqueBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'gothic':
                drawGothicBorder(x, y, w, h, curve, curveRatio);
                break;
            case 'art-deco':
                drawArtDecoBorder(x, y, w, h, curve, curveRatio);
                break;
            default:
                drawElegantBorder(x, y, w, h, cornerCut, curve, curveRatio);
        }
        
        ctx.closePath();
        
        // 使用 evenodd 规则，外部矩形减去内部边框路径
        // 先绘制外部大矩形（逆时针）
        ctx.moveTo(0, 0);
        ctx.lineTo(0, height);
        ctx.lineTo(width, height);
        ctx.lineTo(width, 0);
        ctx.lineTo(0, 0);
        
        // 用边框外颜色填充边框外部区域
        ctx.fillStyle = controls.bgColor2.value;
        ctx.fill('evenodd');
        
        ctx.restore();
    }

    // 绘制背景
    function drawBackground(width, height) {
        ctx.fillStyle = controls.bgColor1.value;
        ctx.fillRect(0, 0, width, height);
    }


    // 绘制循环背景图案
    function drawDiamondPattern(width, height) {
        const size = parseInt(controls.diamondSize.value);
        const opacity = parseInt(controls.diamondOpacity.value) / 100;
        const lightColor = controls.diamondLight.value;
        const darkColor = controls.diamondDark.value;
        const patternStyle = controls.patternStyle.value;

        ctx.save();
        ctx.globalAlpha = opacity;

        // 计算边框内区域 - 使用自适应参数
        let padding = 0;
        if (controls.enableBorder.checked) {
            const adaptive = getAdaptiveParams();
            padding = adaptive.padding;
        }
        const innerX = padding;
        const innerY = padding;
        const innerWidth = width - padding * 2;
        const innerHeight = height - padding * 2;

        // 创建裁剪区域（边框内的圆角矩形）
        if (padding > 0) {
            ctx.beginPath();
            roundRect(ctx, innerX + 10, innerY + 10, innerWidth - 20, innerHeight - 20, 10);
            ctx.clip();
        }

        switch (patternStyle) {
            case 'diamond':
                drawDiamondTiles(width, height, size, lightColor, darkColor);
                break;
            case 'grid':
                drawCheckerGrid(width, height, size, lightColor, darkColor);
                break;
            case 'dots':
                drawDotPattern(width, height, size, lightColor, darkColor);
                break;
            case 'stripes':
                drawDiagonalStripes(width, height, size, lightColor, darkColor);
                break;
            case 'cross':
                drawCrossGrid(width, height, size, lightColor, darkColor);
                break;
            case 'honeycomb':
                drawHoneycombPattern(width, height, size, lightColor, darkColor);
                break;
            case 'stars':
                drawStarSparklePattern(width, height, size, lightColor, darkColor);
                break;
            case 'music':
                drawMusicStaffPattern(width, height, size, lightColor, darkColor);
                break;
            case 'floral':
                drawFloralPattern(width, height, size, lightColor, darkColor);
                break;
            default:
                drawDiamondTiles(width, height, size, lightColor, darkColor);
        }

        ctx.restore();
    }

    // 菱形图案 - 45度旋转的棋盘格
    function drawDiamondTiles(width, height, size, lightColor, darkColor) {
        const diagSize = size * Math.sqrt(2);
        
        for (let row = -1; row < Math.ceil(height / size) + 1; row++) {
            for (let col = -1; col < Math.ceil(width / size) + 1; col++) {
                const x = col * size;
                const y = row * size;
                const isLight = (row + col) % 2 === 0;
                
                ctx.save();
                ctx.translate(x + size / 2, y + size / 2);
                ctx.rotate(Math.PI / 4);
                
                ctx.fillStyle = isLight ? lightColor : darkColor;
                ctx.fillRect(-diagSize / 2, -diagSize / 2, diagSize, diagSize);
                
                ctx.restore();
            }
        }
    }

    // 方格棋盘
    function drawCheckerGrid(width, height, size, lightColor, darkColor) {
        for (let row = -1; row < Math.ceil(height / size) + 1; row++) {
            for (let col = -1; col < Math.ceil(width / size) + 1; col++) {
                const x = col * size;
                const y = row * size;
                const isLight = (row + col) % 2 === 0;
                ctx.fillStyle = isLight ? lightColor : darkColor;
                ctx.fillRect(x, y, size, size);
            }
        }
    }

    // 圆点排列
    function drawDotPattern(width, height, size, lightColor, darkColor) {
        const radius = Math.max(3, size * 0.18);
        const gap = size;
        
        for (let row = -1; row < Math.ceil(height / gap) + 1; row++) {
            for (let col = -1; col < Math.ceil(width / gap) + 1; col++) {
                const x = col * gap + gap / 2;
                const y = row * gap + gap / 2;
                const isLight = (row + col) % 2 === 0;
                
                ctx.fillStyle = isLight ? lightColor : darkColor;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // 斜纹条纹
    function drawDiagonalStripes(width, height, size, lightColor, darkColor) {
        const stripeWidth = Math.max(8, size * 0.6);
        const gap = Math.max(6, size * 0.4);
        const step = stripeWidth + gap;
        const diag = Math.sqrt(width * width + height * height);
        
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate(-Math.PI / 4);

        for (let i = -diag; i <= diag; i += step) {
            const index = Math.round((i + diag) / step);
            ctx.fillStyle = index % 2 === 0 ? lightColor : darkColor;
            ctx.fillRect(i, -diag, stripeWidth, diag * 2);
        }

        ctx.restore();
    }

    // 交错网格（横竖线交错）
    function drawCrossGrid(width, height, size, lightColor, darkColor) {
        const lineWidth = Math.max(1, size * 0.08);
        ctx.lineWidth = lineWidth;

        // 横线
        ctx.strokeStyle = lightColor;
        ctx.beginPath();
        for (let y = 0; y <= height + size; y += size) {
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();

        // 竖线
        ctx.strokeStyle = darkColor;
        ctx.beginPath();
        for (let x = 0; x <= width + size; x += size) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        ctx.stroke();
    }

    // 蜂巢六边形
    function drawHoneycombPattern(width, height, size, lightColor, darkColor) {
        const r = Math.max(6, size * 0.35);
        const hexHeight = Math.sqrt(3) * r;
        const stepX = r * 1.5;
        const stepY = hexHeight;

        for (let row = -1; row < Math.ceil(height / stepY) + 2; row++) {
            for (let col = -1; col < Math.ceil(width / stepX) + 2; col++) {
                const offsetX = (row % 2 === 0) ? 0 : stepX / 2;
                const x = col * stepX + offsetX;
                const y = row * stepY;
                const isLight = (row + col) % 2 === 0;

                ctx.fillStyle = isLight ? lightColor : darkColor;
                drawHexagon(x, y, r);
                ctx.fill();
            }
        }
    }

    function drawHexagon(x, y, r) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i + Math.PI / 6;
            const px = x + r * Math.cos(angle);
            const py = y + r * Math.sin(angle);
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.closePath();
    }

    // 星光闪烁
    function drawStarSparklePattern(width, height, size, lightColor, darkColor) {
        const gap = Math.max(20, size * 1.1);
        const starR = Math.max(6, size * 0.25);

        for (let row = -1; row < Math.ceil(height / gap) + 1; row++) {
            for (let col = -1; col < Math.ceil(width / gap) + 1; col++) {
                const x = col * gap + gap / 2;
                const y = row * gap + gap / 2;
                const isLight = (row + col) % 2 === 0;

                drawStar(x, y, starR, isLight ? lightColor : darkColor);
            }
        }
    }

    function drawStar(x, y, r, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.3, -r * 0.3);
        ctx.lineTo(r, 0);
        ctx.lineTo(r * 0.3, r * 0.3);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.3, r * 0.3);
        ctx.lineTo(-r, 0);
        ctx.lineTo(-r * 0.3, -r * 0.3);
        ctx.closePath();
        ctx.fill();

        // 中心点
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 音符线谱
    function drawMusicStaffPattern(width, height, size, lightColor, darkColor) {
        const lineGap = Math.max(6, size * 0.35);
        const staffGap = lineGap * 6;
        const noteGap = Math.max(24, size * 1.2);
        const noteR = Math.max(4, size * 0.18);

        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.strokeStyle = lightColor;

        for (let baseY = 0; baseY < height + staffGap; baseY += staffGap) {
            // 五线谱
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const y = baseY + i * lineGap;
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
            ctx.stroke();

            // 音符
            for (let x = noteGap / 2; x < width + noteGap; x += noteGap) {
                const y = baseY + lineGap * (1 + (x / noteGap) % 3);
                ctx.fillStyle = darkColor;
                ctx.beginPath();
                ctx.ellipse(x, y, noteR * 1.2, noteR, -Math.PI / 6, 0, Math.PI * 2);
                ctx.fill();

                // 符干
                ctx.strokeStyle = darkColor;
                ctx.beginPath();
                ctx.moveTo(x + noteR, y - noteR * 0.5);
                ctx.lineTo(x + noteR, y - noteR * 3);
                ctx.stroke();
            }
        }
    }

    // 花纹蔓影
    function drawFloralPattern(width, height, size, lightColor, darkColor) {
        const gap = Math.max(26, size * 1.1);
        const petalR = Math.max(4, size * 0.18);
        const centerR = petalR * 0.5;

        for (let row = -1; row < Math.ceil(height / gap) + 1; row++) {
            for (let col = -1; col < Math.ceil(width / gap) + 1; col++) {
                const x = col * gap + gap / 2;
                const y = row * gap + gap / 2;
                const isLight = (row + col) % 2 === 0;

                ctx.save();
                ctx.translate(x, y);
                ctx.rotate((row + col) * 0.3);

                // 花瓣
                ctx.fillStyle = isLight ? lightColor : darkColor;
                for (let i = 0; i < 5; i++) {
                    const angle = (Math.PI * 2 * i) / 5;
                    const px = Math.cos(angle) * petalR * 1.4;
                    const py = Math.sin(angle) * petalR * 1.4;
                    ctx.beginPath();
                    ctx.ellipse(px, py, petalR, petalR * 0.7, angle, 0, Math.PI * 2);
                    ctx.fill();
                }

                // 花心
                ctx.fillStyle = isLight ? darkColor : lightColor;
                ctx.beginPath();
                ctx.arc(0, 0, centerR, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
    }

    // 绘制角色剪影
    function drawCharacter(width, height) {
        if (!characterImageData) return;

        const opacity = parseInt(controls.characterOpacity.value) / 100;
        const position = controls.characterPosition.value;

        ctx.save();
        ctx.globalAlpha = opacity;

        // 计算图片尺寸（保持宽高比，高度填满画布）
        const imgRatio = characterImageData.width / characterImageData.height;
        const drawHeight = height;
        const drawWidth = drawHeight * imgRatio;

        let x = 0;
        if (position === 'left') {
            x = -drawWidth * 0.2;
        } else if (position === 'right') {
            x = width - drawWidth * 0.8;
        } else {
            x = (width - drawWidth) / 2;
        }

        ctx.drawImage(characterImageData, x, 0, drawWidth, drawHeight);
        ctx.restore();
    }

    // 绘制渐变叠加
    function drawGradientOverlay(width, height) {
        const direction = controls.gradientDirection.value;
        const startColor = controls.gradientStart.value;
        const endColor = controls.gradientEnd.value;
        const intensity = parseInt(controls.gradientIntensity.value) / 100;

        let gradient;
        if (direction === 'horizontal') {
            gradient = ctx.createLinearGradient(0, 0, width, 0);
        } else if (direction === 'vertical') {
            gradient = ctx.createLinearGradient(0, 0, 0, height);
        } else if (direction === 'radial') {
            gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 2);
        } else {
            // diagonal
            gradient = ctx.createLinearGradient(0, 0, width, height);
        }

        gradient.addColorStop(0, hexToRgba(startColor, intensity));
        gradient.addColorStop(1, hexToRgba(endColor, intensity));

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }

    // 计算基于角落装饰大小的自适应参数
    function getAdaptiveParams() {
        const cornerSize = parseInt(controls.cornerSize.value);
        const basePadding = parseInt(controls.borderPadding.value);
        
        // 角落装饰需要的最小空间（装饰大小的一半作为基准）
        const cornerSpace = cornerSize * 0.5;
        
        // 自适应边距：取用户设置和角落装饰所需空间的较大值
        const adaptivePadding = Math.max(basePadding, cornerSpace + 10);
        
        // 自适应切角大小：根据角落装饰大小调整
        const adaptiveCornerCut = cornerSize * 0.4;
        
        return {
            padding: adaptivePadding,
            cornerCut: adaptiveCornerCut,
            cornerSpace: cornerSpace
        };
    }

    // 绘制装饰边框
    function drawBorder(width, height) {
        const color = controls.borderColor.value;
        const lineWidth = parseInt(controls.borderWidth.value);
        const layers = parseInt(controls.borderLayers.value);
        const borderStyle = controls.borderStyle.value;
        const curveAmount = parseInt(controls.borderCurve.value);
        const curveRatio = parseInt(controls.borderCurveRatio.value) / 100;
        const cornerCutBase = parseInt(controls.borderCornerCut.value);
        
        // 获取自适应参数
        const adaptive = getAdaptiveParams();
        const padding = adaptive.padding;

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 根据边框样式绘制
        for (let i = 0; i < layers; i++) {
            const offset = padding + i * (lineWidth + 10);
            const x = offset;
            const y = offset;
            const w = width - offset * 2;
            const h = height - offset * 2;
            const cornerCut = cornerCutBase + i * 8;
            const curve = curveAmount + i * 3;

            ctx.beginPath();
            
            switch (borderStyle) {
                case 'elegant':
                    drawElegantBorder(x, y, w, h, cornerCut, curve, curveRatio);
                    break;
                case 'classic':
                    drawClassicBorder(x, y, w, h);
                    break;
                case 'round':
                    drawRoundBorder(x, y, w, h, cornerCut);
                    break;
                case 'wave':
                    drawWaveBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'scallop':
                    drawScallopBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'diamond-cut':
                    drawDiamondCutBorder(x, y, w, h, cornerCut);
                    break;
                case 'inward-curve':
                    drawInwardCurveBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'inward-double':
                    drawInwardDoubleBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'inward-corner':
                    drawInwardCornerBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'inward-arch':
                    drawInwardArchBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'inward-lens':
                    drawInwardLensBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'zigzag':
                    drawZigzagBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'cloud':
                    drawCloudBorder(x, y, w, h, curve);
                    break;
                case 'baroque':
                    drawBaroqueBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'gothic':
                    drawGothicBorder(x, y, w, h, curve, curveRatio);
                    break;
                case 'art-deco':
                    drawArtDecoBorder(x, y, w, h, curve, curveRatio);
                    break;
                default:
                    drawElegantBorder(x, y, w, h, cornerCut, curve, curveRatio);
            }
            
            ctx.closePath();
            ctx.stroke();
        }

        // 在边框上添加装饰性圆点
        if (controls.enableDots.checked) {
            drawBorderDots(width, height, padding, lineWidth, layers, cornerCutBase, color);
        }
    }

    // 优雅内凹边框（带占比控制）
    function drawElegantBorder(x, y, w, h, cornerCut, inset, ratio) {
        // 内凹区域的宽度基于占比
        const inwardWidth = Math.min(w, h) * ratio * 0.3;
        
        // 左上角
        ctx.moveTo(x + cornerCut, y);
        
        // 上边 - 带内凹
        const topMid = x + w / 2;
        ctx.lineTo(topMid - inwardWidth, y);
        ctx.quadraticCurveTo(topMid, y + inset, topMid + inwardWidth, y);
        ctx.lineTo(x + w - cornerCut, y);
        
        // 右上角 - 优雅的内凹角
        ctx.lineTo(x + w - cornerCut * 0.3, y + cornerCut * 0.3);
        ctx.quadraticCurveTo(x + w - cornerCut * 0.15, y + cornerCut * 0.5, x + w, y + cornerCut);
        
        // 右边 - 带内凹
        const rightMid = y + h / 2;
        ctx.lineTo(x + w, rightMid - inwardWidth);
        ctx.quadraticCurveTo(x + w - inset, rightMid, x + w, rightMid + inwardWidth);
        ctx.lineTo(x + w, y + h - cornerCut);
        
        // 右下角
        ctx.lineTo(x + w - cornerCut * 0.3, y + h - cornerCut * 0.3);
        ctx.quadraticCurveTo(x + w - cornerCut * 0.5, y + h - cornerCut * 0.15, x + w - cornerCut, y + h);
        
        // 下边
        const bottomMid = x + w / 2;
        ctx.lineTo(bottomMid + inwardWidth, y + h);
        ctx.quadraticCurveTo(bottomMid, y + h - inset, bottomMid - inwardWidth, y + h);
        ctx.lineTo(x + cornerCut, y + h);
        
        // 左下角
        ctx.lineTo(x + cornerCut * 0.3, y + h - cornerCut * 0.3);
        ctx.quadraticCurveTo(x + cornerCut * 0.15, y + h - cornerCut * 0.5, x, y + h - cornerCut);
        
        // 左边
        const leftMid = y + h / 2;
        ctx.lineTo(x, leftMid + inwardWidth);
        ctx.quadraticCurveTo(x + inset, leftMid, x, leftMid - inwardWidth);
        ctx.lineTo(x, y + cornerCut);
        
        // 左上角闭合
        ctx.lineTo(x + cornerCut * 0.3, y + cornerCut * 0.3);
        ctx.quadraticCurveTo(x + cornerCut * 0.5, y + cornerCut * 0.15, x + cornerCut, y);
    }

    // 经典方框
    function drawClassicBorder(x, y, w, h) {
        ctx.rect(x, y, w, h);
    }

    // 圆角边框
    function drawRoundBorder(x, y, w, h, radius) {
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.arcTo(x + w, y, x + w, y + radius, radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
        ctx.lineTo(x + radius, y + h);
        ctx.arcTo(x, y + h, x, y + h - radius, radius);
        ctx.lineTo(x, y + radius);
        ctx.arcTo(x, y, x + radius, y, radius);
    }

    // 波浪边框（带占比控制）
    function drawWaveBorder(x, y, w, h, amplitude, ratio) {
        const waveCount = Math.max(4, Math.round(12 * ratio));
        const waveWidth = w / waveCount;
        const waveHeight = h / waveCount;
        
        ctx.moveTo(x, y);
        
        // 上边波浪
        for (let i = 0; i < waveCount; i++) {
            const startX = x + i * waveWidth;
            const midX = startX + waveWidth / 2;
            const endX = startX + waveWidth;
            ctx.quadraticCurveTo(midX, y + (i % 2 === 0 ? amplitude : -amplitude), endX, y);
        }
        
        // 右边波浪
        for (let i = 0; i < waveCount; i++) {
            const startY = y + i * waveHeight;
            const midY = startY + waveHeight / 2;
            const endY = startY + waveHeight;
            ctx.quadraticCurveTo(x + w + (i % 2 === 0 ? -amplitude : amplitude), midY, x + w, endY);
        }
        
        // 下边波浪
        for (let i = 0; i < waveCount; i++) {
            const startX = x + w - i * waveWidth;
            const midX = startX - waveWidth / 2;
            const endX = startX - waveWidth;
            ctx.quadraticCurveTo(midX, y + h + (i % 2 === 0 ? -amplitude : amplitude), endX, y + h);
        }
        
        // 左边波浪
        for (let i = 0; i < waveCount; i++) {
            const startY = y + h - i * waveHeight;
            const midY = startY - waveHeight / 2;
            const endY = startY - waveHeight;
            ctx.quadraticCurveTo(x + (i % 2 === 0 ? amplitude : -amplitude), midY, x, endY);
        }
    }

    // 扇贝边框（带占比控制）
    function drawScallopBorder(x, y, w, h, depth, ratio) {
        const scallopCount = Math.max(4, Math.round(16 * ratio));
        const scallopWidthH = w / scallopCount;
        const scallopWidthV = h / scallopCount;
        
        ctx.moveTo(x, y);
        
        // 上边扇贝（向内凹）
        for (let i = 0; i < scallopCount; i++) {
            const startX = x + i * scallopWidthH;
            const endX = startX + scallopWidthH;
            const midX = (startX + endX) / 2;
            ctx.quadraticCurveTo(midX, y + depth, endX, y);
        }
        
        // 右边扇贝（向内凹）
        for (let i = 0; i < scallopCount; i++) {
            const startY = y + i * scallopWidthV;
            const endY = startY + scallopWidthV;
            const midY = (startY + endY) / 2;
            ctx.quadraticCurveTo(x + w - depth, midY, x + w, endY);
        }
        
        // 下边扇贝（向内凹）
        for (let i = 0; i < scallopCount; i++) {
            const startX = x + w - i * scallopWidthH;
            const endX = startX - scallopWidthH;
            const midX = (startX + endX) / 2;
            ctx.quadraticCurveTo(midX, y + h - depth, endX, y + h);
        }
        
        // 左边扇贝（向内凹）
        for (let i = 0; i < scallopCount; i++) {
            const startY = y + h - i * scallopWidthV;
            const endY = startY - scallopWidthV;
            const midY = (startY + endY) / 2;
            ctx.quadraticCurveTo(x + depth, midY, x, endY);
        }
    }

    // 钻石切割边框（八角形）
    function drawDiamondCutBorder(x, y, w, h, cut) {
        ctx.moveTo(x + cut, y);
        ctx.lineTo(x + w - cut, y);
        ctx.lineTo(x + w, y + cut);
        ctx.lineTo(x + w, y + h - cut);
        ctx.lineTo(x + w - cut, y + h);
        ctx.lineTo(x + cut, y + h);
        ctx.lineTo(x, y + h - cut);
        ctx.lineTo(x, y + cut);
        ctx.lineTo(x + cut, y);
    }

    // 四向内凹边框（带占比控制）
    function drawInwardCurveBorder(x, y, w, h, curve, ratio) {
        const midX = x + w / 2;
        const midY = y + h / 2;
        const curveDepth = curve * (0.5 + ratio);
        
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(midX, y + curveDepth, x + w, y);
        ctx.quadraticCurveTo(x + w - curveDepth, midY, x + w, y + h);
        ctx.quadraticCurveTo(midX, y + h - curveDepth, x, y + h);
        ctx.quadraticCurveTo(x + curveDepth, midY, x, y);
    }

    // 双重内凹边框
    function drawInwardDoubleBorder(x, y, w, h, curve, ratio) {
        const inwardWidth = Math.min(w, h) * ratio * 0.2;
        const spacing = w * 0.15;
        
        ctx.moveTo(x, y);
        
        // 上边 - 双重内凹
        const topQ1 = x + w * 0.25;
        const topQ2 = x + w * 0.5;
        const topQ3 = x + w * 0.75;
        ctx.lineTo(topQ1 - inwardWidth, y);
        ctx.quadraticCurveTo(topQ1, y + curve, topQ1 + inwardWidth, y);
        ctx.lineTo(topQ3 - inwardWidth, y);
        ctx.quadraticCurveTo(topQ3, y + curve, topQ3 + inwardWidth, y);
        ctx.lineTo(x + w, y);
        
        // 右边 - 双重内凹
        const rightQ1 = y + h * 0.25;
        const rightQ3 = y + h * 0.75;
        ctx.lineTo(x + w, rightQ1 - inwardWidth);
        ctx.quadraticCurveTo(x + w - curve, rightQ1, x + w, rightQ1 + inwardWidth);
        ctx.lineTo(x + w, rightQ3 - inwardWidth);
        ctx.quadraticCurveTo(x + w - curve, rightQ3, x + w, rightQ3 + inwardWidth);
        ctx.lineTo(x + w, y + h);
        
        // 下边 - 双重内凹
        ctx.lineTo(topQ3 + inwardWidth, y + h);
        ctx.quadraticCurveTo(topQ3, y + h - curve, topQ3 - inwardWidth, y + h);
        ctx.lineTo(topQ1 + inwardWidth, y + h);
        ctx.quadraticCurveTo(topQ1, y + h - curve, topQ1 - inwardWidth, y + h);
        ctx.lineTo(x, y + h);
        
        // 左边 - 双重内凹
        ctx.lineTo(x, rightQ3 + inwardWidth);
        ctx.quadraticCurveTo(x + curve, rightQ3, x, rightQ3 - inwardWidth);
        ctx.lineTo(x, rightQ1 + inwardWidth);
        ctx.quadraticCurveTo(x + curve, rightQ1, x, rightQ1 - inwardWidth);
        ctx.lineTo(x, y);
    }

    // 角落内凹边框
    function drawInwardCornerBorder(x, y, w, h, curve, ratio) {
        const cornerSize = Math.min(w, h) * ratio * 0.3;
        const curveDepth = curve * 1.5;
        
        // 左上角内凹
        ctx.moveTo(x + cornerSize, y);
        ctx.lineTo(x + w - cornerSize, y);
        
        // 右上角内凹
        ctx.quadraticCurveTo(x + w - cornerSize + curveDepth, y + cornerSize - curveDepth, x + w, y + cornerSize);
        ctx.lineTo(x + w, y + h - cornerSize);
        
        // 右下角内凹
        ctx.quadraticCurveTo(x + w - cornerSize + curveDepth, y + h - cornerSize + curveDepth, x + w - cornerSize, y + h);
        ctx.lineTo(x + cornerSize, y + h);
        
        // 左下角内凹
        ctx.quadraticCurveTo(x + cornerSize - curveDepth, y + h - cornerSize + curveDepth, x, y + h - cornerSize);
        ctx.lineTo(x, y + cornerSize);
        
        // 回到左上角
        ctx.quadraticCurveTo(x + cornerSize - curveDepth, y + cornerSize - curveDepth, x + cornerSize, y);
    }

    // 拱形内凹边框
    function drawInwardArchBorder(x, y, w, h, curve, ratio) {
        const archWidth = w * ratio * 0.4;
        const archHeight = curve * 2;
        
        ctx.moveTo(x, y);
        
        // 上边 - 大拱形内凹
        const topMid = x + w / 2;
        ctx.lineTo(topMid - archWidth, y);
        ctx.bezierCurveTo(
            topMid - archWidth * 0.5, y + archHeight,
            topMid + archWidth * 0.5, y + archHeight,
            topMid + archWidth, y
        );
        ctx.lineTo(x + w, y);
        
        // 右边 - 大拱形内凹
        const rightMid = y + h / 2;
        ctx.lineTo(x + w, rightMid - archWidth);
        ctx.bezierCurveTo(
            x + w - archHeight, rightMid - archWidth * 0.5,
            x + w - archHeight, rightMid + archWidth * 0.5,
            x + w, rightMid + archWidth
        );
        ctx.lineTo(x + w, y + h);
        
        // 下边 - 大拱形内凹
        ctx.lineTo(topMid + archWidth, y + h);
        ctx.bezierCurveTo(
            topMid + archWidth * 0.5, y + h - archHeight,
            topMid - archWidth * 0.5, y + h - archHeight,
            topMid - archWidth, y + h
        );
        ctx.lineTo(x, y + h);
        
        // 左边 - 大拱形内凹
        ctx.lineTo(x, rightMid + archWidth);
        ctx.bezierCurveTo(
            x + archHeight, rightMid + archWidth * 0.5,
            x + archHeight, rightMid - archWidth * 0.5,
            x, rightMid - archWidth
        );
        ctx.lineTo(x, y);
    }

    // 透镜内凹边框（四边都是大弧形内凹）
    function drawInwardLensBorder(x, y, w, h, curve, ratio) {
        const curveDepth = curve * (1 + ratio);
        
        ctx.moveTo(x, y);
        
        // 上边 - 透镜形内凹
        ctx.bezierCurveTo(
            x + w * 0.33, y + curveDepth,
            x + w * 0.67, y + curveDepth,
            x + w, y
        );
        
        // 右边 - 透镜形内凹
        ctx.bezierCurveTo(
            x + w - curveDepth, y + h * 0.33,
            x + w - curveDepth, y + h * 0.67,
            x + w, y + h
        );
        
        // 下边 - 透镜形内凹
        ctx.bezierCurveTo(
            x + w * 0.67, y + h - curveDepth,
            x + w * 0.33, y + h - curveDepth,
            x, y + h
        );
        
        // 左边 - 透镜形内凹
        ctx.bezierCurveTo(
            x + curveDepth, y + h * 0.67,
            x + curveDepth, y + h * 0.33,
            x, y
        );
    }

    // 锯齿边框
    function drawZigzagBorder(x, y, w, h, amplitude, ratio) {
        const zigCount = Math.max(6, Math.round(20 * ratio));
        const zigWidth = w / zigCount;
        const zigHeight = h / zigCount;
        
        ctx.moveTo(x, y);
        
        // 上边锯齿（向内）
        for (let i = 0; i < zigCount; i++) {
            const startX = x + i * zigWidth;
            const midX = startX + zigWidth / 2;
            const endX = startX + zigWidth;
            ctx.lineTo(midX, y + amplitude);
            ctx.lineTo(endX, y);
        }
        
        // 右边锯齿（向内）
        for (let i = 0; i < zigCount; i++) {
            const startY = y + i * zigHeight;
            const midY = startY + zigHeight / 2;
            const endY = startY + zigHeight;
            ctx.lineTo(x + w - amplitude, midY);
            ctx.lineTo(x + w, endY);
        }
        
        // 下边锯齿（向内）
        for (let i = 0; i < zigCount; i++) {
            const startX = x + w - i * zigWidth;
            const midX = startX - zigWidth / 2;
            const endX = startX - zigWidth;
            ctx.lineTo(midX, y + h - amplitude);
            ctx.lineTo(endX, y + h);
        }
        
        // 左边锯齿（向内）
        for (let i = 0; i < zigCount; i++) {
            const startY = y + h - i * zigHeight;
            const midY = startY - zigHeight / 2;
            const endY = startY - zigHeight;
            ctx.lineTo(x + amplitude, midY);
            ctx.lineTo(x, endY);
        }
    }

    // 云朵边框
    function drawCloudBorder(x, y, w, h, size) {
        const cloudCount = 6;
        const cloudWidthH = w / cloudCount;
        const cloudWidthV = h / cloudCount;
        
        ctx.moveTo(x, y + size);
        
        // 左上角弧
        ctx.arc(x + size, y + size, size, Math.PI, Math.PI * 1.5);
        
        // 上边云朵
        for (let i = 0; i < cloudCount - 1; i++) {
            const centerX = x + size + cloudWidthH * (i + 0.5);
            ctx.arc(centerX, y, size * 0.7, Math.PI, 0, true);
        }
        
        // 右上角弧
        ctx.arc(x + w - size, y + size, size, Math.PI * 1.5, 0);
        
        // 右边云朵
        for (let i = 0; i < cloudCount - 1; i++) {
            const centerY = y + size + cloudWidthV * (i + 0.5);
            ctx.arc(x + w, centerY, size * 0.7, Math.PI * 1.5, Math.PI * 0.5, true);
        }
        
        // 右下角弧
        ctx.arc(x + w - size, y + h - size, size, 0, Math.PI * 0.5);
        
        // 下边云朵
        for (let i = cloudCount - 2; i >= 0; i--) {
            const centerX = x + size + cloudWidthH * (i + 0.5);
            ctx.arc(centerX, y + h, size * 0.7, 0, Math.PI, true);
        }
        
        // 左下角弧
        ctx.arc(x + size, y + h - size, size, Math.PI * 0.5, Math.PI);
        
        // 左边云朵
        for (let i = cloudCount - 2; i >= 0; i--) {
            const centerY = y + size + cloudWidthV * (i + 0.5);
            ctx.arc(x, centerY, size * 0.7, Math.PI * 0.5, Math.PI * 1.5, true);
        }
    }

    // 巴洛克风格边框
    function drawBaroqueBorder(x, y, w, h, curve, ratio) {
        const scrollSize = curve * (0.5 + ratio);
        const cornerSize = Math.min(w, h) * 0.15;
        
        ctx.moveTo(x + cornerSize, y);
        
        // 上边 - 带卷曲装饰
        const topMid = x + w / 2;
        ctx.lineTo(topMid - scrollSize * 2, y);
        ctx.bezierCurveTo(
            topMid - scrollSize, y + scrollSize,
            topMid + scrollSize, y + scrollSize,
            topMid + scrollSize * 2, y
        );
        ctx.lineTo(x + w - cornerSize, y);
        
        // 右上角卷曲
        ctx.bezierCurveTo(
            x + w - cornerSize * 0.3, y + cornerSize * 0.3,
            x + w - cornerSize * 0.3, y + cornerSize * 0.7,
            x + w, y + cornerSize
        );
        
        // 右边 - 带卷曲
        const rightMid = y + h / 2;
        ctx.lineTo(x + w, rightMid - scrollSize * 2);
        ctx.bezierCurveTo(
            x + w - scrollSize, rightMid - scrollSize,
            x + w - scrollSize, rightMid + scrollSize,
            x + w, rightMid + scrollSize * 2
        );
        ctx.lineTo(x + w, y + h - cornerSize);
        
        // 右下角卷曲
        ctx.bezierCurveTo(
            x + w - cornerSize * 0.3, y + h - cornerSize * 0.3,
            x + w - cornerSize * 0.7, y + h - cornerSize * 0.3,
            x + w - cornerSize, y + h
        );
        
        // 下边
        ctx.lineTo(topMid + scrollSize * 2, y + h);
        ctx.bezierCurveTo(
            topMid + scrollSize, y + h - scrollSize,
            topMid - scrollSize, y + h - scrollSize,
            topMid - scrollSize * 2, y + h
        );
        ctx.lineTo(x + cornerSize, y + h);
        
        // 左下角
        ctx.bezierCurveTo(
            x + cornerSize * 0.3, y + h - cornerSize * 0.3,
            x + cornerSize * 0.3, y + h - cornerSize * 0.7,
            x, y + h - cornerSize
        );
        
        // 左边
        ctx.lineTo(x, rightMid + scrollSize * 2);
        ctx.bezierCurveTo(
            x + scrollSize, rightMid + scrollSize,
            x + scrollSize, rightMid - scrollSize,
            x, rightMid - scrollSize * 2
        );
        ctx.lineTo(x, y + cornerSize);
        
        // 左上角
        ctx.bezierCurveTo(
            x + cornerSize * 0.3, y + cornerSize * 0.3,
            x + cornerSize * 0.7, y + cornerSize * 0.3,
            x + cornerSize, y
        );
    }

    // 哥特式边框
    function drawGothicBorder(x, y, w, h, curve, ratio) {
        const pointHeight = curve * (1 + ratio);
        const archCount = Math.max(3, Math.round(8 * ratio));
        const archWidth = w / archCount;
        const archHeightV = h / archCount;
        
        ctx.moveTo(x, y);
        
        // 上边 - 哥特式尖拱
        for (let i = 0; i < archCount; i++) {
            const startX = x + i * archWidth;
            const midX = startX + archWidth / 2;
            const endX = startX + archWidth;
            ctx.lineTo(midX - archWidth * 0.1, y);
            ctx.lineTo(midX, y + pointHeight);
            ctx.lineTo(midX + archWidth * 0.1, y);
            ctx.lineTo(endX, y);
        }
        
        // 右边 - 哥特式尖拱
        for (let i = 0; i < archCount; i++) {
            const startY = y + i * archHeightV;
            const midY = startY + archHeightV / 2;
            const endY = startY + archHeightV;
            ctx.lineTo(x + w, midY - archHeightV * 0.1);
            ctx.lineTo(x + w - pointHeight, midY);
            ctx.lineTo(x + w, midY + archHeightV * 0.1);
            ctx.lineTo(x + w, endY);
        }
        
        // 下边 - 哥特式尖拱
        for (let i = archCount - 1; i >= 0; i--) {
            const startX = x + i * archWidth;
            const midX = startX + archWidth / 2;
            const endX = i > 0 ? startX : x;
            ctx.lineTo(midX + archWidth * 0.1, y + h);
            ctx.lineTo(midX, y + h - pointHeight);
            ctx.lineTo(midX - archWidth * 0.1, y + h);
            ctx.lineTo(endX, y + h);
        }
        
        // 左边 - 哥特式尖拱
        for (let i = archCount - 1; i >= 0; i--) {
            const startY = y + i * archHeightV;
            const midY = startY + archHeightV / 2;
            const endY = i > 0 ? startY : y;
            ctx.lineTo(x, midY + archHeightV * 0.1);
            ctx.lineTo(x + pointHeight, midY);
            ctx.lineTo(x, midY - archHeightV * 0.1);
            ctx.lineTo(x, endY);
        }
    }

    // 装饰艺术风格边框
    function drawArtDecoBorder(x, y, w, h, curve, ratio) {
        const stepSize = curve * 0.5;
        const stepCount = Math.max(2, Math.round(5 * ratio));
        const cornerSize = Math.min(w, h) * 0.12;
        
        // 从左上角开始，阶梯式角落
        ctx.moveTo(x + cornerSize, y);
        ctx.lineTo(x + w - cornerSize, y);
        
        // 右上角阶梯
        for (let i = 0; i < stepCount; i++) {
            const step = cornerSize / stepCount;
            ctx.lineTo(x + w - cornerSize + step * (i + 1), y);
            ctx.lineTo(x + w - cornerSize + step * (i + 1), y + step * (i + 1));
        }
        
        ctx.lineTo(x + w, y + cornerSize);
        ctx.lineTo(x + w, y + h - cornerSize);
        
        // 右下角阶梯
        for (let i = 0; i < stepCount; i++) {
            const step = cornerSize / stepCount;
            ctx.lineTo(x + w, y + h - cornerSize + step * (i + 1));
            ctx.lineTo(x + w - step * (i + 1), y + h - cornerSize + step * (i + 1));
        }
        
        ctx.lineTo(x + w - cornerSize, y + h);
        ctx.lineTo(x + cornerSize, y + h);
        
        // 左下角阶梯
        for (let i = 0; i < stepCount; i++) {
            const step = cornerSize / stepCount;
            ctx.lineTo(x + cornerSize - step * (i + 1), y + h);
            ctx.lineTo(x + cornerSize - step * (i + 1), y + h - step * (i + 1));
        }
        
        ctx.lineTo(x, y + h - cornerSize);
        ctx.lineTo(x, y + cornerSize);
        
        // 左上角阶梯
        for (let i = 0; i < stepCount; i++) {
            const step = cornerSize / stepCount;
            ctx.lineTo(x, y + cornerSize - step * (i + 1));
            ctx.lineTo(x + step * (i + 1), y + cornerSize - step * (i + 1));
        }
        
        ctx.lineTo(x + cornerSize, y);
    }

    // 绘制边框装饰点
    function drawBorderDots(width, height, padding, lineWidth, layers, baseCornerCut, color) {
        const dotRadius = lineWidth * 1.2;
        const smallDotRadius = lineWidth * 0.6;
        
        ctx.fillStyle = color;
        
        // 边框中点的大圆点
        const midDots = [
            { x: width / 2, y: padding },                    // 上
            { x: width / 2, y: height - padding },           // 下
            { x: padding, y: height / 2 },                   // 左
            { x: width - padding, y: height / 2 }            // 右
        ];
        
        midDots.forEach(pos => {
            // 外圈
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, dotRadius * 1.5, 0, Math.PI * 2);
            ctx.stroke();
            // 内圈实心
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, dotRadius * 0.8, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // 角落的小圆点装饰
        const innerPadding = padding + (layers - 1) * (lineWidth + 10);
        const cornerCut = baseCornerCut + (layers - 1) * 8;
        
        // 每个角落放置多个小圆点
        const cornerDotGroups = [
            // 左上角区域
            [
                { x: innerPadding + cornerCut * 0.5, y: innerPadding + cornerCut * 0.2 },
                { x: innerPadding + cornerCut * 0.2, y: innerPadding + cornerCut * 0.5 }
            ],
            // 右上角区域
            [
                { x: width - innerPadding - cornerCut * 0.5, y: innerPadding + cornerCut * 0.2 },
                { x: width - innerPadding - cornerCut * 0.2, y: innerPadding + cornerCut * 0.5 }
            ],
            // 右下角区域
            [
                { x: width - innerPadding - cornerCut * 0.5, y: height - innerPadding - cornerCut * 0.2 },
                { x: width - innerPadding - cornerCut * 0.2, y: height - innerPadding - cornerCut * 0.5 }
            ],
            // 左下角区域
            [
                { x: innerPadding + cornerCut * 0.5, y: height - innerPadding - cornerCut * 0.2 },
                { x: innerPadding + cornerCut * 0.2, y: height - innerPadding - cornerCut * 0.5 }
            ]
        ];
        
        cornerDotGroups.forEach(group => {
            group.forEach(pos => {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, smallDotRadius, 0, Math.PI * 2);
                ctx.fill();
            });
        });
    }

    // 绘制角落装饰
    function drawCornerDecorations(width, height) {
        const size = parseInt(controls.cornerSize.value);
        const fillColor = controls.cornerColor.value;
        const enableStroke = controls.enableCornerStroke.checked;
        const strokeColor = controls.cornerStrokeColor.value;
        const enableGlow = controls.enableCornerGlow.checked;
        const glowColor = controls.cornerGlowColor.value;
        const glowIntensity = parseInt(controls.cornerGlowIntensity.value) / 100;
        const enableShadow = controls.enableCornerShadow.checked;
        const enableFrame = controls.enableCornerFrame.checked;
        const frameSize = parseInt(controls.cornerFrameSize.value) / 100;
        const frameWidth = parseInt(controls.cornerFrameWidth.value);
        const frameColor = controls.cornerFrameColor.value;
        const frameFillColor = controls.cornerFrameFill.value;
        const enableRotation = controls.enableCornerRotation.checked;
        const renderMode = controls.cornerRenderMode ? controls.cornerRenderMode.value : 'fill';
        const baseStrokeWidth = Math.max(1, parseInt(controls.cornerStrokeWidth.value));
        
        // 获取四角样式

        const useDifferent = controls.enableDifferentCorners.checked;
        const styles = useDifferent ? [
            controls.cornerStyleTL.value,
            controls.cornerStyleTR.value,
            controls.cornerStyleBR.value,
            controls.cornerStyleBL.value
        ] : [
            controls.cornerStyle.value,
            controls.cornerStyle.value,
            controls.cornerStyle.value,
            controls.cornerStyle.value
        ];

        // 四个角落位置和旋转角度
        const corners = [
            { x: 0, y: 0, rotation: enableRotation ? 0 : 0 },                    // 左上
            { x: width, y: 0, rotation: enableRotation ? Math.PI / 2 : 0 },      // 右上
            { x: width, y: height, rotation: enableRotation ? Math.PI : 0 },     // 右下
            { x: 0, y: height, rotation: enableRotation ? -Math.PI / 2 : 0 }     // 左下
        ];
        
        // 四角的位置偏移（不旋转时需要不同的偏移方向）
        const offsets = enableRotation ? [
            { x: 1, y: 1 },   // 左上 -> 向右下偏移
            { x: 1, y: 1 },   // 右上 -> 旋转后自动调整
            { x: 1, y: 1 },   // 右下 -> 旋转后自动调整
            { x: 1, y: 1 }    // 左下 -> 旋转后自动调整
        ] : [
            { x: 1, y: 1 },   // 左上 -> 向右下偏移
            { x: -1, y: 1 },  // 右上 -> 向左下偏移
            { x: -1, y: -1 }, // 右下 -> 向左上偏移
            { x: 1, y: -1 }   // 左下 -> 向右上偏移
        ];

        corners.forEach((corner, index) => {
            const style = styles[index];
            const offsetDir = offsets[index];
            
            ctx.save();
            ctx.translate(corner.x, corner.y);
            ctx.rotate(corner.rotation);

            // 计算实际偏移位置
            const offsetX = size * 0.4 * (enableRotation ? 1 : offsetDir.x);
            const offsetY = size * 0.4 * (enableRotation ? 1 : offsetDir.y);

            // 绘制菱形边框（带填充遮挡背景）
            if (enableFrame) {
                drawDiamondFrame(offsetX, offsetY, size * frameSize, frameWidth, frameColor, frameFillColor);
            }

            // 阴影效果
            if (enableShadow) {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = size * 0.15;
                ctx.shadowOffsetX = size * 0.05;
                ctx.shadowOffsetY = size * 0.05;
            }

            const outerSize = size * 0.85;
            const innerSize = enableStroke ? size * 0.75 : size * 0.8;

            // 绘制主体（描边层）
            if (enableStroke) {
                if (renderMode === 'stroke') {
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = Math.max(1, baseStrokeWidth * 1.4);
                    ctx.lineJoin = 'round';
                    ctx.lineCap = 'round';
                    drawSymbolPath(style, offsetX, offsetY, outerSize);
                    ctx.stroke();
                } else {
                    ctx.fillStyle = strokeColor;
                    drawSymbolPath(style, offsetX, offsetY, outerSize);
                    ctx.fill();
                }
            }

            // 清除阴影用于后续层
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // 绘制主体
            if (renderMode === 'stroke') {
                ctx.strokeStyle = fillColor;
                ctx.lineWidth = baseStrokeWidth;
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                drawSymbolPath(style, offsetX, offsetY, innerSize);
                ctx.stroke();
            } else {
                ctx.fillStyle = fillColor;
                drawSymbolPath(style, offsetX, offsetY, innerSize);
                ctx.fill();
            }

            // 光泽效果（仅填充模式）
            if (enableGlow && renderMode === 'fill') {
                ctx.save();
                
                // 创建裁剪路径
                drawSymbolPath(style, offsetX, offsetY, innerSize * 0.95);
                ctx.clip();
                
                // 绘制高光渐变
                const gradient = ctx.createLinearGradient(
                    offsetX - size * 0.3, offsetY - size * 0.3,
                    offsetX + size * 0.3, offsetY + size * 0.3
                );
                gradient.addColorStop(0, hexToRgba(glowColor, glowIntensity * 0.8));
                gradient.addColorStop(0.3, hexToRgba(glowColor, glowIntensity * 0.3));
                gradient.addColorStop(0.6, 'transparent');
                gradient.addColorStop(1, 'transparent');
                
                ctx.fillStyle = gradient;
                ctx.fillRect(offsetX - size, offsetY - size, size * 2, size * 2);
                
                // 添加边缘高光
                const edgeGradient = ctx.createRadialGradient(
                    offsetX - size * 0.2, offsetY - size * 0.2, 0,
                    offsetX, offsetY, size * 0.5
                );
                edgeGradient.addColorStop(0, hexToRgba(glowColor, glowIntensity * 0.6));
                edgeGradient.addColorStop(0.5, hexToRgba(glowColor, glowIntensity * 0.2));
                edgeGradient.addColorStop(1, 'transparent');
                
                ctx.fillStyle = edgeGradient;
                ctx.fillRect(offsetX - size, offsetY - size, size * 2, size * 2);
                
                ctx.restore();
            }



            ctx.restore();
        });
    }

    // 绘制菱形边框（带填充遮挡背景）
    function drawDiamondFrame(x, y, size, lineWidth, strokeColor, fillColor) {
        const r = size / 2;
        
        ctx.save();
        
        // 首先填充菱形内部（遮挡背景）
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
        
        // 外层菱形边框
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'miter';
        
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.stroke();
        
        // 内层菱形边框（增加层次感）
        const innerR = r * 0.85;
        ctx.lineWidth = lineWidth * 0.6;
        
        ctx.beginPath();
        ctx.moveTo(x, y - innerR);
        ctx.lineTo(x + innerR, y);
        ctx.lineTo(x, y + innerR);
        ctx.lineTo(x - innerR, y);
        ctx.closePath();
        ctx.stroke();
        
        // 四角小圆点装饰
        const dotR = lineWidth * 0.8;
        ctx.fillStyle = strokeColor;
        
        // 上
        ctx.beginPath();
        ctx.arc(x, y - r, dotR, 0, Math.PI * 2);
        ctx.fill();
        
        // 右
        ctx.beginPath();
        ctx.arc(x + r, y, dotR, 0, Math.PI * 2);
        ctx.fill();
        
        // 下
        ctx.beginPath();
        ctx.arc(x, y + r, dotR, 0, Math.PI * 2);
        ctx.fill();
        
        // 左
        ctx.beginPath();
        ctx.arc(x - r, y, dotR, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }

    // 绘制符号路径（不填充，只定义路径）
    function drawSymbolPath(style, x, y, size) {
        ctx.beginPath();
        
        switch (style) {
            case 'club':
                createClubPath(x, y, size);
                break;
            case 'club-fancy':
                createFancyClubPath(x, y, size);
                break;
            case 'spade':
                createSpadePath(x, y, size);
                break;
            case 'spade-fancy':
                createFancySpadePath(x, y, size);
                break;
            case 'heart':
                createHeartPath(x, y, size);
                break;
            case 'heart-fancy':
                createFancyHeartPath(x, y, size);
                break;
            case 'diamond':
                createDiamondShapePath(x, y, size);
                break;
            case 'diamond-fancy':
                createFancyDiamondPath(x, y, size);
                break;
            case 'star':
                createStarPath(x, y, size * 0.5, 5);
                break;
            case 'star6':
                createStarPath(x, y, size * 0.5, 6);
                break;
            case 'flower':
                createFlowerPath(x, y, size * 0.5);
                break;
            case 'sakura':
                createSakuraPath(x, y, size * 0.5);
                break;
            case 'leaf':
                createLeafPath(x, y, size);
                break;
            case 'moon':
                createMoonPath(x, y, size * 0.5);
                break;
            case 'note1':
                createNote1Path(x, y, size);
                break;
            case 'note2':
                createNote2Path(x, y, size);
                break;
            case 'note3':
                createTrebleClefPath(x, y, size);
                break;
            case 'note4':
                createQuarterNotePath(x, y, size);
                break;
            case 'note5':
                createHalfNotePath(x, y, size);
                break;
            case 'note6':
                createWholeNotePath(x, y, size);
                break;
            case 'note7':
                createBassClefPath(x, y, size);
                break;
            case 'note8':
                createEighthRestPath(x, y, size);
                break;
            case 'note9':
                createTripletNotePath(x, y, size);
                break;
            case 'crown':
                createCrownPath(x, y, size);
                break;
            case 'ribbon':
                createRibbonPath(x, y, size);
                break;
            case 'crystal':
                createCrystalPath(x, y, size);
                break;
            case 'swirl':
                createSwirlPath(x, y, size * 0.5);
                break;
            case 'ornate':
                createOrnatePath(x, y, size);
                break;
            case 'fleur':
                createFleurDeLisPath(x, y, size);
                break;
            default:
                createClubPath(x, y, size);
        }
    }

    // 华丽梅花（带卷曲装饰）♣
    function createFancyClubPath(x, y, size) {
        const r = size / 4;
        
        // 主体梅花
        // 上圆
        ctx.arc(x, y - r * 0.9, r * 1.1, 0, Math.PI * 2);
        // 左下圆
        ctx.moveTo(x - r * 1.0 + r * 1.1, y + r * 0.35);
        ctx.arc(x - r * 1.0, y + r * 0.35, r * 1.1, 0, Math.PI * 2);
        // 右下圆
        ctx.moveTo(x + r * 1.0 + r * 1.1, y + r * 0.35);
        ctx.arc(x + r * 1.0, y + r * 0.35, r * 1.1, 0, Math.PI * 2);
        
        // 装饰性柄（更优雅）
        ctx.moveTo(x - r * 0.25, y + r * 0.6);
        ctx.quadraticCurveTo(x - r * 0.4, y + r * 1.2, x - r * 0.6, y + r * 1.8);
        ctx.quadraticCurveTo(x - r * 0.3, y + r * 2.0, x, y + r * 1.6);
        ctx.quadraticCurveTo(x + r * 0.3, y + r * 2.0, x + r * 0.6, y + r * 1.8);
        ctx.quadraticCurveTo(x + r * 0.4, y + r * 1.2, x + r * 0.25, y + r * 0.6);
        ctx.closePath();
        
        // 左侧卷曲装饰
        ctx.moveTo(x - r * 1.8, y + r * 0.8);
        ctx.quadraticCurveTo(x - r * 2.5, y + r * 0.3, x - r * 2.3, y - r * 0.3);
        ctx.quadraticCurveTo(x - r * 2.0, y - r * 0.6, x - r * 1.6, y - r * 0.3);
        ctx.quadraticCurveTo(x - r * 1.4, y + r * 0.1, x - r * 1.5, y + r * 0.5);
        
        // 右侧卷曲装饰
        ctx.moveTo(x + r * 1.8, y + r * 0.8);
        ctx.quadraticCurveTo(x + r * 2.5, y + r * 0.3, x + r * 2.3, y - r * 0.3);
        ctx.quadraticCurveTo(x + r * 2.0, y - r * 0.6, x + r * 1.6, y - r * 0.3);
        ctx.quadraticCurveTo(x + r * 1.4, y + r * 0.1, x + r * 1.5, y + r * 0.5);
    }

    // 华丽黑桃（带卷曲装饰）♠
    function createFancySpadePath(x, y, size) {
        const r = size / 3;
        
        // 主体黑桃
        ctx.moveTo(x, y - r * 1.6);
        ctx.bezierCurveTo(x + r * 2.2, y - r * 0.6, x + r * 1.7, y + r * 1.1, x, y + r * 0.6);
        ctx.bezierCurveTo(x - r * 1.7, y + r * 1.1, x - r * 2.2, y - r * 0.6, x, y - r * 1.6);
        
        // 装饰性柄
        ctx.moveTo(x - r * 0.25, y + r * 0.4);
        ctx.quadraticCurveTo(x - r * 0.5, y + r * 1.0, x - r * 0.7, y + r * 1.5);
        ctx.quadraticCurveTo(x - r * 0.3, y + r * 1.7, x, y + r * 1.3);
        ctx.quadraticCurveTo(x + r * 0.3, y + r * 1.7, x + r * 0.7, y + r * 1.5);
        ctx.quadraticCurveTo(x + r * 0.5, y + r * 1.0, x + r * 0.25, y + r * 0.4);
        ctx.closePath();
        
        // 顶部卷曲装饰
        ctx.moveTo(x - r * 0.3, y - r * 1.6);
        ctx.quadraticCurveTo(x - r * 0.8, y - r * 2.2, x - r * 0.5, y - r * 2.5);
        ctx.quadraticCurveTo(x, y - r * 2.3, x + r * 0.5, y - r * 2.5);
        ctx.quadraticCurveTo(x + r * 0.8, y - r * 2.2, x + r * 0.3, y - r * 1.6);
        
        // 左侧卷曲
        ctx.moveTo(x - r * 1.5, y);
        ctx.quadraticCurveTo(x - r * 2.2, y - r * 0.3, x - r * 2.0, y - r * 0.8);
        ctx.quadraticCurveTo(x - r * 1.7, y - r * 1.0, x - r * 1.4, y - r * 0.6);
        
        // 右侧卷曲
        ctx.moveTo(x + r * 1.5, y);
        ctx.quadraticCurveTo(x + r * 2.2, y - r * 0.3, x + r * 2.0, y - r * 0.8);
        ctx.quadraticCurveTo(x + r * 1.7, y - r * 1.0, x + r * 1.4, y - r * 0.6);
    }

    // 华丽红心（带装饰）♥
    function createFancyHeartPath(x, y, size) {
        const r = size / 3;
        
        // 主体心形
        ctx.moveTo(x, y + r * 1.2);
        ctx.bezierCurveTo(x + r * 2.2, y - r * 0.8, x + r * 0.6, y - r * 1.7, x, y - r * 0.6);
        ctx.bezierCurveTo(x - r * 0.6, y - r * 1.7, x - r * 2.2, y - r * 0.8, x, y + r * 1.2);
        
        // 顶部装饰卷曲
        ctx.moveTo(x - r * 0.8, y - r * 1.2);
        ctx.quadraticCurveTo(x - r * 1.2, y - r * 1.8, x - r * 0.8, y - r * 2.0);
        ctx.quadraticCurveTo(x - r * 0.4, y - r * 1.9, x - r * 0.5, y - r * 1.5);
        
        ctx.moveTo(x + r * 0.8, y - r * 1.2);
        ctx.quadraticCurveTo(x + r * 1.2, y - r * 1.8, x + r * 0.8, y - r * 2.0);
        ctx.quadraticCurveTo(x + r * 0.4, y - r * 1.9, x + r * 0.5, y - r * 1.5);
        
        // 底部小装饰
        ctx.moveTo(x, y + r * 1.2);
        ctx.lineTo(x - r * 0.15, y + r * 1.5);
        ctx.lineTo(x, y + r * 1.4);
        ctx.lineTo(x + r * 0.15, y + r * 1.5);
        ctx.closePath();
    }

    // 华丽方块（带装饰）♦
    function createFancyDiamondPath(x, y, size) {
        const r = size / 2.5;
        
        // 主体方块（带曲线边缘）
        ctx.moveTo(x, y - r * 1.4);
        ctx.quadraticCurveTo(x + r * 0.3, y - r * 0.7, x + r * 1.1, y);
        ctx.quadraticCurveTo(x + r * 0.3, y + r * 0.7, x, y + r * 1.4);
        ctx.quadraticCurveTo(x - r * 0.3, y + r * 0.7, x - r * 1.1, y);
        ctx.quadraticCurveTo(x - r * 0.3, y - r * 0.7, x, y - r * 1.4);
        
        // 四角装饰
        // 上
        ctx.moveTo(x, y - r * 1.4);
        ctx.lineTo(x - r * 0.2, y - r * 1.7);
        ctx.quadraticCurveTo(x, y - r * 1.9, x + r * 0.2, y - r * 1.7);
        ctx.closePath();
        
        // 右
        ctx.moveTo(x + r * 1.1, y);
        ctx.lineTo(x + r * 1.4, y - r * 0.2);
        ctx.quadraticCurveTo(x + r * 1.6, y, x + r * 1.4, y + r * 0.2);
        ctx.closePath();
        
        // 下
        ctx.moveTo(x, y + r * 1.4);
        ctx.lineTo(x + r * 0.2, y + r * 1.7);
        ctx.quadraticCurveTo(x, y + r * 1.9, x - r * 0.2, y + r * 1.7);
        ctx.closePath();
        
        // 左
        ctx.moveTo(x - r * 1.1, y);
        ctx.lineTo(x - r * 1.4, y + r * 0.2);
        ctx.quadraticCurveTo(x - r * 1.6, y, x - r * 1.4, y - r * 0.2);
        ctx.closePath();
    }

    // 华丽装饰图案
    function createOrnatePath(x, y, size) {
        const r = size / 3;
        
        // 中心菱形
        ctx.moveTo(x, y - r * 0.8);
        ctx.lineTo(x + r * 0.8, y);
        ctx.lineTo(x, y + r * 0.8);
        ctx.lineTo(x - r * 0.8, y);
        ctx.closePath();
        
        // 四个方向的卷曲装饰
        const directions = [
            { angle: -Math.PI / 2, label: 'top' },
            { angle: 0, label: 'right' },
            { angle: Math.PI / 2, label: 'bottom' },
            { angle: Math.PI, label: 'left' }
        ];
        
        directions.forEach(dir => {
            const cos = Math.cos(dir.angle);
            const sin = Math.sin(dir.angle);
            
            // 主延伸
            const startX = x + cos * r * 0.8;
            const startY = y + sin * r * 0.8;
            const endX = x + cos * r * 1.8;
            const endY = y + sin * r * 1.8;
            
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            
            // 末端装饰圆
            ctx.moveTo(endX + r * 0.25, endY);
            ctx.arc(endX, endY, r * 0.25, 0, Math.PI * 2);
            
            // 侧边卷曲
            const perpCos = Math.cos(dir.angle + Math.PI / 2);
            const perpSin = Math.sin(dir.angle + Math.PI / 2);
            
            const midX = x + cos * r * 1.3;
            const midY = y + sin * r * 1.3;
            
            ctx.moveTo(midX, midY);
            ctx.quadraticCurveTo(
                midX + perpCos * r * 0.6 + cos * r * 0.3,
                midY + perpSin * r * 0.6 + sin * r * 0.3,
                midX + perpCos * r * 0.4,
                midY + perpSin * r * 0.4
            );
            
            ctx.moveTo(midX, midY);
            ctx.quadraticCurveTo(
                midX - perpCos * r * 0.6 + cos * r * 0.3,
                midY - perpSin * r * 0.6 + sin * r * 0.3,
                midX - perpCos * r * 0.4,
                midY - perpSin * r * 0.4
            );
        });
    }

    // 鸢尾花纹章
    function createFleurDeLisPath(x, y, size) {
        const r = size / 3;
        
        // 中央花瓣
        ctx.moveTo(x, y - r * 1.8);
        ctx.quadraticCurveTo(x + r * 0.4, y - r * 1.2, x + r * 0.3, y - r * 0.5);
        ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.2, x, y);
        ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.2, x - r * 0.3, y - r * 0.5);
        ctx.quadraticCurveTo(x - r * 0.4, y - r * 1.2, x, y - r * 1.8);
        
        // 左花瓣
        ctx.moveTo(x - r * 0.3, y - r * 0.3);
        ctx.quadraticCurveTo(x - r * 1.0, y - r * 0.8, x - r * 1.4, y - r * 0.6);
        ctx.quadraticCurveTo(x - r * 1.6, y - r * 0.3, x - r * 1.3, y);
        ctx.quadraticCurveTo(x - r * 1.0, y + r * 0.2, x - r * 0.5, y + r * 0.1);
        ctx.quadraticCurveTo(x - r * 0.3, y, x - r * 0.2, y + r * 0.3);
        
        // 右花瓣
        ctx.moveTo(x + r * 0.3, y - r * 0.3);
        ctx.quadraticCurveTo(x + r * 1.0, y - r * 0.8, x + r * 1.4, y - r * 0.6);
        ctx.quadraticCurveTo(x + r * 1.6, y - r * 0.3, x + r * 1.3, y);
        ctx.quadraticCurveTo(x + r * 1.0, y + r * 0.2, x + r * 0.5, y + r * 0.1);
        ctx.quadraticCurveTo(x + r * 0.3, y, x + r * 0.2, y + r * 0.3);
        
        // 底部
        ctx.moveTo(x - r * 0.2, y + r * 0.3);
        ctx.lineTo(x - r * 0.4, y + r * 0.8);
        ctx.quadraticCurveTo(x - r * 0.5, y + r * 1.2, x - r * 0.3, y + r * 1.4);
        ctx.lineTo(x, y + r * 1.0);
        ctx.lineTo(x + r * 0.3, y + r * 1.4);
        ctx.quadraticCurveTo(x + r * 0.5, y + r * 1.2, x + r * 0.4, y + r * 0.8);
        ctx.lineTo(x + r * 0.2, y + r * 0.3);
        
        // 横杠装饰
        ctx.moveTo(x - r * 0.6, y + r * 0.5);
        ctx.lineTo(x + r * 0.6, y + r * 0.5);
        ctx.lineTo(x + r * 0.6, y + r * 0.65);
        ctx.lineTo(x - r * 0.6, y + r * 0.65);
        ctx.closePath();
    }

    // 梅花路径 ♣
    function createClubPath(x, y, size) {
        const r = size / 4;
        
        // 上圆
        ctx.arc(x, y - r * 0.8, r, 0, Math.PI * 2);
        // 左下圆
        ctx.moveTo(x - r * 0.9 + r, y + r * 0.3);
        ctx.arc(x - r * 0.9, y + r * 0.3, r, 0, Math.PI * 2);
        // 右下圆
        ctx.moveTo(x + r * 0.9 + r, y + r * 0.3);
        ctx.arc(x + r * 0.9, y + r * 0.3, r, 0, Math.PI * 2);
        // 柄
        ctx.moveTo(x - r * 0.3, y + r * 0.5);
        ctx.lineTo(x + r * 0.3, y + r * 0.5);
        ctx.lineTo(x + r * 0.5, y + r * 1.8);
        ctx.lineTo(x - r * 0.5, y + r * 1.8);
        ctx.closePath();
    }

    // 黑桃路径 ♠
    function createSpadePath(x, y, size) {
        const r = size / 3;
        
        ctx.moveTo(x, y - r * 1.5);
        ctx.bezierCurveTo(x + r * 2, y - r * 0.5, x + r * 1.5, y + r, x, y + r * 0.5);
        ctx.bezierCurveTo(x - r * 1.5, y + r, x - r * 2, y - r * 0.5, x, y - r * 1.5);
        // 柄
        ctx.moveTo(x - r * 0.3, y + r * 0.3);
        ctx.lineTo(x + r * 0.3, y + r * 0.3);
        ctx.lineTo(x + r * 0.5, y + r * 1.5);
        ctx.lineTo(x - r * 0.5, y + r * 1.5);
        ctx.closePath();
    }

    // 红心路径 ♥
    function createHeartPath(x, y, size) {
        const r = size / 3;
        
        ctx.moveTo(x, y + r);
        ctx.bezierCurveTo(x + r * 2, y - r, x + r * 0.5, y - r * 1.5, x, y - r * 0.5);
        ctx.bezierCurveTo(x - r * 0.5, y - r * 1.5, x - r * 2, y - r, x, y + r);
    }

    // 方块路径 ♦
    function createDiamondShapePath(x, y, size) {
        const r = size / 2.5;
        
        ctx.moveTo(x, y - r * 1.3);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r * 1.3);
        ctx.lineTo(x - r, y);
        ctx.closePath();
    }

    // 星星路径 ★
    function createStarPath(x, y, r, points) {
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 === 0 ? r : r * 0.5;
            const angle = (Math.PI / points) * i - Math.PI / 2;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.closePath();
    }

    // 花朵路径 ❀
    function createFlowerPath(x, y, r) {
        const petals = 6;
        
        for (let i = 0; i < petals; i++) {
            const angle = (Math.PI * 2 / petals) * i;
            const px = x + Math.cos(angle) * r * 0.5;
            const py = y + Math.sin(angle) * r * 0.5;
            
            ctx.moveTo(px + r * 0.5, py);
            ctx.arc(px, py, r * 0.5, 0, Math.PI * 2);
        }
        
        // 中心
        ctx.moveTo(x + r * 0.3, y);
        ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    }

    // 樱花路径 🌸
    function createSakuraPath(x, y, r) {
        const petals = 5;
        
        for (let i = 0; i < petals; i++) {
            const angle = (Math.PI * 2 / petals) * i - Math.PI / 2;
            const px = x + Math.cos(angle) * r * 0.3;
            const py = y + Math.sin(angle) * r * 0.3;
            
            // 花瓣形状（心形）
            const petalAngle = angle;
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(
                x + Math.cos(petalAngle - 0.3) * r * 0.8,
                y + Math.sin(petalAngle - 0.3) * r * 0.8,
                x + Math.cos(petalAngle) * r,
                y + Math.sin(petalAngle) * r
            );
            ctx.quadraticCurveTo(
                x + Math.cos(petalAngle + 0.3) * r * 0.8,
                y + Math.sin(petalAngle + 0.3) * r * 0.8,
                x, y
            );
        }
        
        // 中心
        ctx.moveTo(x + r * 0.15, y);
        ctx.arc(x, y, r * 0.15, 0, Math.PI * 2);
    }

    // 叶子路径 🍃
    function createLeafPath(x, y, size) {
        const r = size / 3;
        
        ctx.moveTo(x, y - r * 1.2);
        ctx.quadraticCurveTo(x + r * 1.5, y - r * 0.5, x + r * 0.8, y + r * 0.8);
        ctx.quadraticCurveTo(x + r * 0.3, y + r * 1.2, x, y + r * 1.2);
        ctx.quadraticCurveTo(x - r * 0.3, y + r * 1.2, x - r * 0.8, y + r * 0.8);
        ctx.quadraticCurveTo(x - r * 1.5, y - r * 0.5, x, y - r * 1.2);
    }

    // 月亮路径 ☽
    function createMoonPath(x, y, r) {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.moveTo(x + r * 0.3 + r * 0.7, y);
        ctx.arc(x + r * 0.3, y, r * 0.7, 0, Math.PI * 2, true);
    }

    // 八分音符路径 ♪
    function createNote1Path(x, y, size) {
        const r = size / 4;
        
        // 音符头（椭圆）
        ctx.ellipse(x - r * 0.5, y + r * 1.2, r * 0.8, r * 0.6, -0.3, 0, Math.PI * 2);
        
        // 音符杆
        ctx.moveTo(x + r * 0.2, y + r * 1);
        ctx.lineTo(x + r * 0.2, y - r * 1.5);
        ctx.lineTo(x + r * 0.4, y - r * 1.5);
        ctx.lineTo(x + r * 0.4, y + r * 1);
        ctx.closePath();
        
        // 音符旗
        ctx.moveTo(x + r * 0.3, y - r * 1.5);
        ctx.quadraticCurveTo(x + r * 1.5, y - r * 1, x + r * 0.8, y - r * 0.3);
        ctx.lineTo(x + r * 0.3, y - r * 0.6);
    }

    // 双八分音符路径 ♫
    function createNote2Path(x, y, size) {
        const r = size / 5;
        
        // 左音符头
        ctx.ellipse(x - r * 1.2, y + r * 1.2, r * 0.7, r * 0.5, -0.3, 0, Math.PI * 2);
        // 右音符头
        ctx.moveTo(x + r * 1.2 + r * 0.7, y + r * 0.8);
        ctx.ellipse(x + r * 1.2, y + r * 0.8, r * 0.7, r * 0.5, -0.3, 0, Math.PI * 2);
        
        // 左杆
        ctx.moveTo(x - r * 0.6, y + r * 1);
        ctx.lineTo(x - r * 0.6, y - r * 1.2);
        ctx.lineTo(x - r * 0.4, y - r * 1.2);
        ctx.lineTo(x - r * 0.4, y + r * 1);
        ctx.closePath();
        
        // 右杆
        ctx.moveTo(x + r * 1.8, y + r * 0.6);
        ctx.lineTo(x + r * 1.8, y - r * 1.5);
        ctx.lineTo(x + r * 2, y - r * 1.5);
        ctx.lineTo(x + r * 2, y + r * 0.6);
        ctx.closePath();
        
        // 横梁
        ctx.moveTo(x - r * 0.5, y - r * 1.2);
        ctx.lineTo(x + r * 1.9, y - r * 1.5);
        ctx.lineTo(x + r * 1.9, y - r * 1.2);
        ctx.lineTo(x - r * 0.5, y - r * 0.9);
        ctx.closePath();
    }

    // 高音谱号路径 𝄞
    function createTrebleClefPath(x, y, size) {
        const r = size / 4;
        
        // 简化的高音谱号
        ctx.moveTo(x, y + r * 1.5);
        ctx.bezierCurveTo(x - r * 1.5, y + r, x - r * 1.2, y - r * 0.5, x, y - r * 0.8);
        ctx.bezierCurveTo(x + r * 1.2, y - r * 1.2, x + r * 1.5, y - r * 0.2, x + r * 0.8, y + r * 0.3);
        ctx.bezierCurveTo(x + r * 0.3, y + r * 0.6, x - r * 0.2, y + r * 0.3, x, y);
        ctx.bezierCurveTo(x + r * 0.5, y - r * 0.5, x + r * 0.3, y - r * 1.5, x, y - r * 1.8);
        ctx.lineTo(x, y - r * 2);
        ctx.lineTo(x + r * 0.2, y - r * 2);
        ctx.lineTo(x + r * 0.2, y - r * 1.6);
        ctx.bezierCurveTo(x + r * 0.8, y - r * 1.2, x + r * 0.8, y - r * 0.3, x + r * 0.2, y + r * 0.2);
        
        // 底部圆
        ctx.moveTo(x + r * 0.4, y + r * 1.8);
        ctx.arc(x, y + r * 1.8, r * 0.4, 0, Math.PI * 2);
    }

    // 四分音符路径 ♩
    function createQuarterNotePath(x, y, size) {
        const r = size / 4;
        
        // 音符头（实心椭圆）
        ctx.ellipse(x, y + r * 1, r * 0.8, r * 0.6, -0.3, 0, Math.PI * 2);
        
        // 音符杆
        ctx.moveTo(x + r * 0.6, y + r * 0.8);
        ctx.lineTo(x + r * 0.6, y - r * 1.8);
        ctx.lineTo(x + r * 0.8, y - r * 1.8);
        ctx.lineTo(x + r * 0.8, y + r * 0.8);
        ctx.closePath();
    }

    // 二分音符路径 𝅗𝅥
    function createHalfNotePath(x, y, size) {
        const r = size / 4;
        
        // 外轮廓
        ctx.ellipse(x, y + r * 1, r * 0.9, r * 0.65, -0.3, 0, Math.PI * 2);
        // 内部空心（反向路径制造空洞）
        ctx.moveTo(x + r * 0.45, y + r * 1);
        ctx.ellipse(x, y + r * 1, r * 0.45, r * 0.3, -0.3, 0, Math.PI * 2, true);
        
        // 音符杆
        ctx.moveTo(x + r * 0.7, y + r * 0.7);
        ctx.lineTo(x + r * 0.7, y - r * 1.8);
        ctx.lineTo(x + r * 0.9, y - r * 1.8);
        ctx.lineTo(x + r * 0.9, y + r * 0.7);
        ctx.closePath();
    }

    // 全音符路径 𝅝
    function createWholeNotePath(x, y, size) {
        const r = size / 4;
        
        ctx.ellipse(x, y + r * 0.9, r * 1.1, r * 0.75, -0.2, 0, Math.PI * 2);
        ctx.moveTo(x + r * 0.55, y + r * 0.9);
        ctx.ellipse(x, y + r * 0.9, r * 0.55, r * 0.35, -0.2, 0, Math.PI * 2, true);
    }

    // 低音谱号路径 𝄢
    function createBassClefPath(x, y, size) {
        const r = size / 3.2;
        
        // 主体旋涡
        ctx.moveTo(x + r * 1.1, y - r * 0.2);
        ctx.bezierCurveTo(x + r * 0.2, y - r * 1.1, x - r * 1.2, y - r * 0.2, x - r * 0.2, y + r * 0.6);
        ctx.bezierCurveTo(x + r * 0.4, y + r * 1.1, x + r * 1.2, y + r * 0.4, x + r * 0.6, y + r * 0.1);
        ctx.bezierCurveTo(x + r * 0.2, y - r * 0.1, x - r * 0.2, y + r * 0.1, x - r * 0.1, y + r * 0.3);
        
        // 两个点
        ctx.moveTo(x + r * 1.2, y - r * 0.45);
        ctx.arc(x + r * 1.2, y - r * 0.45, r * 0.18, 0, Math.PI * 2);
        ctx.moveTo(x + r * 1.2, y + r * 0.35);
        ctx.arc(x + r * 1.2, y + r * 0.35, r * 0.18, 0, Math.PI * 2);
    }

    // 八分休止符路径 𝄽
    function createEighthRestPath(x, y, size) {
        const r = size / 4;
        
        ctx.moveTo(x - r * 0.2, y - r * 1.4);
        ctx.lineTo(x + r * 0.4, y - r * 1.1);
        ctx.quadraticCurveTo(x + r * 0.9, y - r * 0.6, x + r * 0.1, y - r * 0.1);
        ctx.lineTo(x + r * 0.6, y + r * 0.5);
        ctx.quadraticCurveTo(x + r * 0.9, y + r * 0.9, x, y + r * 1.2);
        ctx.lineTo(x - r * 0.3, y + r * 0.9);
        ctx.quadraticCurveTo(x + r * 0.1, y + r * 0.5, x - r * 0.1, y + r * 0.1);
        ctx.closePath();
    }

    // 三连音路径 ♪♪♪
    function createTripletNotePath(x, y, size) {
        const r = size / 6;
        const gap = r * 2.2;

        for (let i = -1; i <= 1; i++) {
            const cx = x + i * gap;
            ctx.ellipse(cx, y + r * 1.1, r * 0.75, r * 0.55, -0.3, 0, Math.PI * 2);
            ctx.moveTo(cx + r * 0.6, y + r * 0.8);
            ctx.lineTo(cx + r * 0.6, y - r * 1.6);
            ctx.lineTo(cx + r * 0.8, y - r * 1.6);
            ctx.lineTo(cx + r * 0.8, y + r * 0.8);
            ctx.closePath();
        }

        // 连音横梁
        ctx.moveTo(x - gap - r * 0.4, y - r * 1.6);
        ctx.lineTo(x + gap + r * 1.2, y - r * 1.9);
        ctx.lineTo(x + gap + r * 1.2, y - r * 1.6);
        ctx.lineTo(x - gap - r * 0.4, y - r * 1.3);
        ctx.closePath();
    }

    // 皇冠路径 👑
    function createCrownPath(x, y, size) {
        const r = size / 3;
        
        // 皇冠主体
        ctx.moveTo(x - r * 1.2, y + r * 0.8);
        ctx.lineTo(x - r * 1.2, y - r * 0.2);
        ctx.lineTo(x - r * 0.6, y + r * 0.3);
        ctx.lineTo(x, y - r * 0.8);
        ctx.lineTo(x + r * 0.6, y + r * 0.3);
        ctx.lineTo(x + r * 1.2, y - r * 0.2);
        ctx.lineTo(x + r * 1.2, y + r * 0.8);
        ctx.closePath();
        
        // 顶部圆点
        ctx.moveTo(x - r * 1.2 + r * 0.15, y - r * 0.2);
        ctx.arc(x - r * 1.2, y - r * 0.35, r * 0.15, 0, Math.PI * 2);
        ctx.moveTo(x + r * 0.15, y - r * 0.8);
        ctx.arc(x, y - r * 0.95, r * 0.15, 0, Math.PI * 2);
        ctx.moveTo(x + r * 1.2 + r * 0.15, y - r * 0.2);
        ctx.arc(x + r * 1.2, y - r * 0.35, r * 0.15, 0, Math.PI * 2);
    }

    // 蝴蝶结路径 🎀
    function createRibbonPath(x, y, size) {
        const r = size / 4;
        
        // 左边蝴蝶
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x - r * 1.5, y - r * 1, x - r * 1.8, y);
        ctx.quadraticCurveTo(x - r * 1.5, y + r * 1, x, y);
        
        // 右边蝴蝶
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + r * 1.5, y - r * 1, x + r * 1.8, y);
        ctx.quadraticCurveTo(x + r * 1.5, y + r * 1, x, y);
        
        // 中心结
        ctx.moveTo(x + r * 0.4, y);
        ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
        
        // 飘带
        ctx.moveTo(x - r * 0.3, y + r * 0.3);
        ctx.quadraticCurveTo(x - r * 0.8, y + r * 1.5, x - r * 0.5, y + r * 1.8);
        ctx.lineTo(x - r * 0.2, y + r * 1.5);
        ctx.quadraticCurveTo(x - r * 0.5, y + r * 1, x, y + r * 0.3);
        
        ctx.moveTo(x + r * 0.3, y + r * 0.3);
        ctx.quadraticCurveTo(x + r * 0.8, y + r * 1.5, x + r * 0.5, y + r * 1.8);
        ctx.lineTo(x + r * 0.2, y + r * 1.5);
        ctx.quadraticCurveTo(x + r * 0.5, y + r * 1, x, y + r * 0.3);
    }

    // 水晶路径 💎
    function createCrystalPath(x, y, size) {
        const r = size / 3;
        
        // 顶部三角
        ctx.moveTo(x, y - r * 1.5);
        ctx.lineTo(x + r * 1.2, y - r * 0.3);
        ctx.lineTo(x + r * 0.8, y + r * 1.2);
        ctx.lineTo(x - r * 0.8, y + r * 1.2);
        ctx.lineTo(x - r * 1.2, y - r * 0.3);
        ctx.closePath();
        
        // 内部切面线（装饰）
        ctx.moveTo(x, y - r * 1.5);
        ctx.lineTo(x - r * 0.4, y + r * 1.2);
        ctx.moveTo(x, y - r * 1.5);
        ctx.lineTo(x + r * 0.4, y + r * 1.2);
        ctx.moveTo(x - r * 1.2, y - r * 0.3);
        ctx.lineTo(x + r * 1.2, y - r * 0.3);
    }

    // 漩涡路径 🌀
    function createSwirlPath(x, y, r) {
        const turns = 2.5;
        const points = 60;
        
        ctx.moveTo(x, y);
        
        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * turns * Math.PI * 2;
            const radius = (i / points) * r;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            ctx.lineTo(px, py);
        }
        
        // 加粗路径
        for (let i = points; i >= 0; i--) {
            const angle = (i / points) * turns * Math.PI * 2;
            const radius = (i / points) * r + r * 0.15;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            ctx.lineTo(px, py);
        }
        
        ctx.closePath();
    }

    // 圆角矩形辅助函数
    function roundRect(ctx, x, y, width, height, radius) {
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
    }

    // 一键主题色自适应
    function applyThemeFromColor(hex) {
        const { h, s, l } = hexToHsl(hex);

        // 背景与外框
        controls.bgColor1.value = hslToHex(h, clamp(s * 0.7, 0.35, 0.75), clamp(l * 0.35, 0.12, 0.28));
        controls.bgColor2.value = hslToHex(h, clamp(s * 0.5, 0.2, 0.6), clamp(l * 0.18, 0.05, 0.18));

        // 菱形/图案
        controls.diamondLight.value = hslToHex(h, clamp(s * 0.35, 0.15, 0.5), clamp(l * 1.2, 0.7, 0.92));
        controls.diamondDark.value = hslToHex(h, clamp(s * 0.55, 0.2, 0.7), clamp(l * 0.45, 0.22, 0.42));

        // 边框主色
        controls.borderColor.value = hslToHex(h, clamp(s * 0.7, 0.3, 0.9), clamp(l * 1.1, 0.7, 0.88));

        // 角落装饰主色与描边
        controls.cornerColor.value = hslToHex(h, clamp(s * 0.6, 0.25, 0.85), clamp(l * 1.15, 0.75, 0.95));
        controls.cornerStrokeColor.value = hslToHex(h, clamp(s * 0.85, 0.4, 1), clamp(l * 0.55, 0.3, 0.55));

        // 菱形边框与填充遮挡
        controls.cornerFrameColor.value = hslToHex(h, clamp(s * 0.8, 0.3, 0.95), clamp(l * 1.0, 0.6, 0.85));
        controls.cornerFrameFill.value = controls.bgColor2.value;

        // 光泽颜色（更亮）
        controls.cornerGlowColor.value = hslToHex(h, clamp(s * 0.2, 0.1, 0.4), clamp(l * 1.35, 0.85, 0.98));

        // 渐变叠加
        controls.gradientStart.value = hslToHex(h, clamp(s * 0.15, 0.08, 0.3), clamp(l * 1.35, 0.85, 0.98));
        controls.gradientEnd.value = hslToHex(h, clamp(s * 0.6, 0.25, 0.8), clamp(l * 0.18, 0.05, 0.18));
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function hexToHsl(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                default:
                    h = (r - g) / d + 4;
            }
            h /= 6;
        }

        return { h, s, l };
    }

    function hslToHex(h, s, l) {
        const hue2rgb = (p, q, t) => {
            let tt = t;
            if (tt < 0) tt += 1;
            if (tt > 1) tt -= 1;
            if (tt < 1 / 6) return p + (q - p) * 6 * tt;
            if (tt < 1 / 2) return q;
            if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
            return p;
        };

        let r;
        let g;
        let b;

        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        return rgbToHex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
    }

    function rgbToHex(r, g, b) {
        return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    }

    // Hex颜色转RGBA
    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }


    // 导出图片
    function exportImage(format) {
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const ext = format === 'png' ? 'png' : 'jpg';
        const t = (key, params) => (window.i18n && typeof window.i18n.t === 'function')
            ? window.i18n.t(key, params)
            : key;
        link.download = t('export_filename', { timestamp, ext });

        
        if (format === 'png') {
            link.href = canvas.toDataURL('image/png');
        } else {
            // JPG需要先填充白色背景
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            tempCtx.drawImage(canvas, 0, 0);
            link.href = tempCanvas.toDataURL('image/jpeg', 0.95);
        }
        
        link.click();
    }


    // 启动
    init();
})();
