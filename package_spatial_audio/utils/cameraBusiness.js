// threejs库
const { createScopedThreejs } = require('threejs-miniprogram');
// 加载gltf库
const { registerGLTFLoader } = require('../../utils/gltf-loader.js');
// 相机每帧图像作为threejs场景的背景图
const webglBusiness = require('./webglBusiness.js')
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
// 设备像素比例
var devicePixelRatio;
// 模型的默认缩放大小
const modelScale = 0.05;
// WebAudio对象
var audioCtx;
// 空间化音频
var positionalAudio,audioListener;

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
        
        if (!mainModel) {
            if (anchors && anchors.length > 0) {
                const anchor = anchors[0]

                model.matrixAutoUpdate = true
                // 将hitTest返回的transform，变换到3D模型的姿态。
                model.matrix.fromArray(anchor.transform)
                // 将矩阵分解到平移position、旋转quaternion，但不修改缩放scale。
                model.matrix.decompose(model.position, model.quaternion, new THREE.Vector3())     
                mainModel = model;
                // 添加模型到场景
                scene.add(model)
                // 透明的墙，声音在墙后面会消失。
                addWall()
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
                callback(model, animations);
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

// 更新3D模型地址
function updateModel(modelUrl) {
    var loader = new THREE.GLTFLoader();
    // loading
    wx.showLoading({
        title: 'Loading Model...',
    });
    loader.load(modelUrl,
        function (gltf) {
            console.log('loadModel', 'success');
            var model = gltf.scene;
            // 复制已有模型的变换
            addModelByReticle(model, mainModel, true)
            // remove old model
            scene.remove(mainModel);
            // save new model
            mainModel = model;

            wx.hideLoading();
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

    wx.hideLoading();
}

// 加载3D模型的动画
function createAnimation(model, animations, clipName) {
    if (!model || !animations) {
        return
    }

    // 动画混合器
    const mixer = new THREE.AnimationMixer(model)
    for (let i = 0; i < animations.length; i++) {
        const clip = animations[i]
        if (clip.name === clipName) {
            const action = mixer.clipAction(clip)
            action.play()
        }
    }

    mixers.push(mixer)
}

// 更新3D模型的动画
function updateAnimation() {
    const dt = clock.getDelta()
    if (mixers) {
        mixers.forEach(function (mixer) {
            mixer.update(dt)
        })
    }
}


// 在threejs的每帧渲染中，使用AR相机更新threejs相机的变换。
function render(frame) {
    // 更新threejs场景的背景
    webglBusiness.renderGL(frame)
    // 更新3D模型的动画
    updateAnimation()
    // 从ar每帧图像获取ar相机对象
    const ar_camera = frame.camera

    if (ar_camera) {
        // 更新three.js相机对象的视图矩阵
        camera.matrixAutoUpdate = false
        camera.matrixWorldInverse.fromArray(ar_camera.viewMatrix)
        camera.matrixWorld.getInverse(camera.matrixWorldInverse)
        // 将矩阵分解到平移position、旋转quaternion、缩放scale，会改变camera姿态。
        camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale)

        // 更新three.js相机对象的投影矩阵
        const projectionMatrix = ar_camera.getProjectionMatrix(NEAR, FAR)
        camera.projectionMatrix.fromArray(projectionMatrix)
        camera.projectionMatrixInverse.getInverse(camera.projectionMatrix)

        // 更新空间化音频的听众
        updateMatrixWorld_listener()
        // 更新空间化音频的音源
        updateMatrixWorld_positionalAudio()
    }

    renderer.autoClearColor = false
    // 这个是three.js相机对象
    renderer.render(scene, camera)
    // 保留模型的正面和背面
    renderer.state.setCullFace(THREE.CullFaceNone)
}

function addWall() {
    // 墙的长度、高度、厚度
    const wallGeometry = new THREE.BoxGeometry(2, 1, 0.05);
    // 墙的颜色
    const wallMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    // 墙的位置
    wall.position.set(0, -0.5, -1);
    // 和音乐播放器模型组合在一起
    scene.add(wall);
}

// 更新听众的位置（跟随场景中的相机）
function updateMatrixWorld_listener() {
    if (!audioCtx || !camera) { 
        return 
    }

    audioListener = audioCtx.listener

    const orientation = new THREE.Vector3();
    orientation.set(0, 0, -1).applyQuaternion(camera.quaternion);

    // 在android上，运行到这里，相机画面会卡住。
    audioListener.setPosition(camera.position.x, camera.position.y, camera.position.z);
    audioListener.setOrientation(orientation.x, orientation.y, orientation.z,
        camera.up.x, camera.up.y, camera.up.z);

}

// 更新音源的位置（跟随场景中的模型）
function updateMatrixWorld_positionalAudio() {
    if (!positionalAudio || !mainModel) { 
        return 
    }
    const panner = positionalAudio.getOutput()

    const orientation = new THREE.Vector3();
    orientation.set(0, 0, 1).applyQuaternion(mainModel.quaternion);

    panner.setPosition(mainModel.position.x, mainModel.position.y, mainModel.position.z);
    panner.setOrientation(orientation.x, orientation.y, orientation.z);
}

function addPositionalAudio(buffer) {
    // 小程序里没有Web版本的AudioContext，传入小程序版本的AudioContext。
    THREE.AudioContext.setContext(audioCtx)
    // 听众
    const listener = new THREE.AudioListener();

    // 音源
    positionalAudio = new THREE.PositionalAudio(listener);
    positionalAudio.setBuffer(buffer);
    positionalAudio.setRefDistance(1);
    positionalAudio.setDirectionalCone(180, 230, 0.1);
    positionalAudio.setLoop(true)
    // 播放音频
    positionalAudio.play()
}

// 创建web audio
function addWebAudio(url) {
    audioCtx = wx.createWebAudioContext()

    wx.request({
        url,
        responseType: 'arraybuffer',
        success: function (res) {
            // 将数据解码为音频
            audioCtx.decodeAudioData(res.data,
                function (buffer) {
                    addPositionalAudio(buffer)
                },
                function (err) {
                    console.log('decodeAudioData', err)
                })
        },
        fail: function (res) {
            console.log('loadAudio', res)
        }
    })
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

    // 渲染层
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
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

// 在光标的位置放置3D模型
// model:3D模型对象 
// copyModel：被复制的3D模型对象 
// isAddModel:是否将3D模型加入到threejs场景
function addModelByReticle(model, copyModel, isAddModel) {
    model.matrixAutoUpdate = true
    model.position.copy(copyModel.position)
    model.rotation.copy(copyModel.rotation)
    console.log('addModelByReticle')
    if (isAddModel) {
        scene.add(model)
    }
}

// 在手指点击的位置放置3D模型
// resetPanel：是否用现实环境中新的平面作为AR的空间坐标系 
// evt：触摸事件 
// isAddModel:是否将3D模型加入到threejs场景
function addModelByHitTest(evt, resetPanel, isAddModel) {
    // 点击可移动3D模型位置
    const touches = evt.changedTouches.length ? evt.changedTouches : evt.touches
    if (touches.length === 1) {
        const touch = touches[0]
        const hitTestRes = session.hitTest(touch.x * devicePixelRatio / canvas.width,
            touch.y * devicePixelRatio / canvas.height,
            resetPanel)

        if (hitTestRes && hitTestRes.length) {
            mainModel.matrixAutoUpdate = true
            mainModel.matrix.fromArray(hitTestRes[0].transform)
            // 将矩阵分解到平移position、旋转quaternion，但不修改缩放scale。
            mainModel.matrix.decompose(mainModel.position, mainModel.quaternion, new THREE.Vector3())
            console.log('addModelByHitTest', mainModel.position)

            if (isAddModel) {
                scene.add(mainModel)
            }
        }
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

    if (devicePixelRatio) {
        devicePixelRatio = null
    }

    if (positionalAudio) {
        positionalAudio.stop()
        positionalAudio = null
    }

    if (audioListener) {
        audioListener = null
    }

    if (audioCtx) {
        // audioCtx.close()
        audioCtx = null
    }

    webglBusiness.dispose()
}

module.exports = {
    loadModel,
    updateModel,
    render,
    initWorldTrack,
    initEnvironment,
    initTHREE,
    createAnimation,
    updateAnimation,
    addModelByReticle,
    addModelByHitTest,
    dispose,
    addWebAudio,
}
