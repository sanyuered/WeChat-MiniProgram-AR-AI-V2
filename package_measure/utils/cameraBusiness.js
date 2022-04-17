// threejs库
const { createScopedThreejs } = require('threejs-miniprogram');
// 加载gltf库
const { registerGLTFLoader } = require('../../utils/gltf-loader.js');
// 相机每帧图像作为threejs场景的背景图
const webglBusiness = require('./webglBusiness.js')
// 绘制线条
const { TubePainter } = require('./tubePainter.js')
// 近截面
const NEAR = 0.001
// 远截面
const FAR = 1000
// 相机、场景、渲染器
var camera, scene, renderer;
// 画布对象
var canvas;
// var touchX, touchY;
// threejs对象
var THREE;
// 自定义的3D模型
var mainModel;
// AR会话
var session;
// 光标模型、跟踪时间的对象
var reticle, clock;
// 保存3D模型的动画
var mixers = [];
// 绘制线条的工具
var painter;
// 是否开始绘制线条
var isStartPaint = false;
// 最近点击光标的位置
var lastPoint;
// 设备像素比例
var devicePixelRatio;
// 光标模型的默认缩放大小
const modelScale = 0.1;

// 修改：创建AR的坐标系
function initWorldTrack(model) {
    if (!session) {
        console.log('The VKSession is not created.')
        return
    }

    wx.showLoading({
        title: '探索平面...',
    });

    session.on('addAnchors', anchors => {
        // 发现新的平面
        wx.hideLoading();

        if (!reticle) {
            if (anchors && anchors.length > 0) {
                const anchor = anchors[0]
                
                model.matrixAutoUpdate = true
                // 将hitTest返回的transform，变换到3D模型的姿态。
                model.matrix.fromArray(anchor.transform)
                // 将矩阵分解到平移position、旋转quaternion，但不修改缩放scale。
                model.matrix.decompose(model.position, model.quaternion, new THREE.Vector3())
                reticle = model
                // 添加模型到场景
                scene.add(model)
            }
        }
    })

    session.on('updateAnchors', anchors => {
        // 因为场景中camera的姿态在自动更新，所以不需要手动更新模型model的姿态。
    })

    session.on('removeAnchors', anchors => {
        // 当平面跟踪丢失时
    })

}

// 加载3D模型
function loadModel(modelUrl, callback) {

    var loader = new THREE.GLTFLoader();
    wx.showLoading({
        title: 'Loading Model...',
    });
    loader.load(modelUrl,
        function (gltf) {
            console.log('loadModel', 'success');
            wx.hideLoading();
            var model = gltf.scene;
            model.scale.set(modelScale, modelScale, modelScale)

            var animations = gltf.animations;

            if (callback) {
                callback(model, animations)
            }
        },
        null,
        function (error) {
            console.log('loadModel', error);
            wx.hideLoading();
            wx.showToast({
                title: 'Loading model failed.',
                icon: 'none',
                duration: 3000,
            });
        });
}

// 更新光标模型的位置
function updateReticle() {
    if (!reticle) {
        return
    }

    const hitTestRes = session.hitTest(0.5, 0.5)

    if (hitTestRes && hitTestRes.length) {
        reticle.matrixAutoUpdate = true
        reticle.matrix.fromArray(hitTestRes[0].transform)
        // 将矩阵分解到平移position、旋转quaternion、缩放scale。
        reticle.matrix.decompose(reticle.position, reticle.quaternion, new THREE.Vector3())
        reticle.visible = true
    } else {
        reticle.visible = false
    }
}

// 在threejs的每帧渲染中，使用AR相机更新threejs相机的变换。
function render(frame) {
    // 更新threejs场景的背景
    webglBusiness.renderGL(frame)
    // 更新光标模型的姿态
    updateReticle()
    // 从ar每帧图像获取ar相机对象
    const ar_camera = frame.camera

    if (ar_camera) {
        // 更新three.js相机对象的视图矩阵
        camera.matrixAutoUpdate = false
        camera.matrixWorldInverse.fromArray(ar_camera.viewMatrix)
        camera.matrixWorld.getInverse(camera.matrixWorldInverse)

        // 更新three.js相机对象的投影矩阵
        const projectionMatrix = ar_camera.getProjectionMatrix(NEAR, FAR)
        camera.projectionMatrix.fromArray(projectionMatrix)
        camera.projectionMatrixInverse.getInverse(camera.projectionMatrix)
    }

    renderer.autoClearColor = false
    // 这个是three.js相机对象
    renderer.render(scene, camera)
    // 保留模型的正面和背面
    renderer.state.setCullFace(THREE.CullFaceNone)
}

// 创建threejs场景
function initTHREE() {
    THREE = createScopedThreejs(canvas)
    console.log('initTHREE')
    registerGLTFLoader(THREE)

    // 相机
    camera = new THREE.Camera()
    // 场景
    scene = new THREE.Scene()

    // 半球光
    const light1 = new THREE.HemisphereLight(0xffffff, 0x444444)
    light1.position.set(0, 0.2, 0)
    scene.add(light1)

    // 平行光
    const light2 = new THREE.DirectionalLight(0xffffff)
    light2.position.set(0, 0.2, 0.1)
    scene.add(light2)

    // 绘制线条的辅助工具
    painter = new TubePainter(THREE);
    painter.setSize(0.4);
    painter.mesh.material.side = THREE.DoubleSide;
    scene.add(painter.mesh);

    // 渲染层
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    })

    // gamma色彩空间校正，以适应人眼对亮度的感觉。
    renderer.gammaOutput = true
    renderer.gammaFactor = 2.2

    // 时间跟踪器用作3D模型动画的更新
    clock = new THREE.Clock()
}

// 调整画布的大小
function calcCanvasSize() {
    console.log('calcCanvasSize')

    const info = wx.getSystemInfoSync()
    devicePixelRatio = info.pixelRatio
    const width = info.windowWidth
    const height = info.windowHeight
    /* 官方示例的代码
    canvas.width = width * devicePixelRatio / 2
    canvas.height = height * devicePixelRatio / 2
    */
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(width, height);
}

// 启动AR会话
function initEnvironment(canvasDom) {
    console.log('initEnvironment')
    // 画布组件的对象
    canvas = canvasDom
    // 创建threejs场景
    initTHREE()
    // 创建AR会话
    session = wx.createVKSession({
        track: {
            // mode参数
            // 1表示检测水平平面
            // 2表示检测垂直平面
            // 3表示检测水平和垂直平面
            plane: { mode: 1 },
        },
        // 新增version参数
        version: 'v2',
    })
    // 开始AR会话
    session.start(err => {
        if (err) {
            console.log('session.start', err)
            return
        }
        console.log('session.start', 'ok')

        // 监视小程序窗口变化
        session.on('resize', function () {
            console.log('session on resize')
            calcCanvasSize()
        })

        // 设置画布的大小
        calcCanvasSize()

        // 初始化webgl的背景
        webglBusiness.initGL(renderer)

        // 每帧渲染
        const onFrame = function (timestamp) {
            if (!session) {
                return
            }
            // 从AR会话获取每帧图像
            const frame = session.getVKFrame(canvas.width, canvas.height)
            if (frame) {
                // threejs渲染过程
                render(frame)
            }
            session.requestAnimationFrame(onFrame)
        }
        session.requestAnimationFrame(onFrame)
    })
}

// 保存光标模型
function setReticle(model) {
    reticle = model
}

function addPoint(color) {
    const geometry = new THREE.CylinderGeometry(0.003, 0.003, 0.003, 32);
    const material = new THREE.MeshBasicMaterial({ color: color });
    const cylinder = new THREE.Mesh(geometry, material);
    addModelByReticle(cylinder, reticle, true)
}

// 在光标的位置放置3D模型
function setRuler(callback) {
    if (!reticle || !painter) {
        return
    }

    const currentPoint = reticle.position
    if (!isStartPaint) {
        // 测量开始
        isStartPaint = true
        // 测量开始时，移动到点击光标的位置
        painter.moveTo(currentPoint)
        // 开始点
        addPoint(0x66cc00)
    } else {
        // 测量结束
        isStartPaint = false
        // 测量过程中，绘制线条
        painter.lineTo(currentPoint)
        painter.update()
        // 结束点
        addPoint(0xff3300)

        if (lastPoint) {
            if (callback) {
                // 测量的距离
                var distance = currentPoint.distanceTo(lastPoint)
                distance = Math.round(distance * 100)
                callback(distance)
            }
        }

    }

    // 保存最近点击光标的位置
    lastPoint = currentPoint.clone()
}

// 在光标的位置放置3D模型
// model:3D模型对象 
// copyModel：被复制的3D模型对象 
// isAddModel:是否将3D模型加入到threejs场景
function addModelByReticle(model, copyModel, isAddModel) {
    model.matrixAutoUpdate = true
    model.position.copy(copyModel.position)
    model.rotation.copy(copyModel.rotation)
    console.log('addModelByReticle', copyModel.position)
    if (isAddModel) {
        scene.add(model)
    }
}

// 将对象回收
function dispose() {
    if (renderer) {
        renderer.dispose()
        renderer = null
    }
    if (scene) {
        scene.dispose()
        scene = null
    }
    if (camera) {
        camera = null
    }
    if (mainModel) {
        mainModel = null
    }

    if (mixers) {
        mixers.forEach(function (mixer) {
            mixer.uncacheRoot(mixer.getRoot())
        })
        mixers = []
    }
    if (clock) {
        clock = null
    }
    if (THREE) {
        THREE = null
    }

    if (canvas) {
        canvas = null
    }
    if (session) {
        session = null
    }
    if (reticle) {
        reticle = null
    }
    if (painter) {
        painter = null
    }
    if (lastPoint) {
        lastPoint = null
    }

    webglBusiness.dispose()
}

module.exports = {
    loadModel,
    render,
    initWorldTrack,
    initEnvironment,
    initTHREE,
    addModelByReticle,
    setReticle,
    setRuler,
    dispose,
}
