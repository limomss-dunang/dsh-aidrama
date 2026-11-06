import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Project } from '../shared/types.ts'

type StageKind = 'character' | 'prop' | 'scene' | 'box'
type PoseId = 'stand' | 'sit' | 'walk' | 'run' | 'kneel' | 'wave' | 'punch' | 'fall'

interface StageKeyframe {
  frame: number
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  pose?: PoseId
}

interface CameraKeyframe {
  frame: number
  x: number
  y: number
  z: number
  tx: number
  ty: number
  tz: number
  fov: number
}

interface StageObject {
  id: string
  kind: StageKind
  refId: string
  name: string
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  sx: number
  sy: number
  sz: number
  color: string
  visible?: boolean
  locked?: boolean
  pose?: PoseId
  keyframes?: StageKeyframe[]
  trail?: Array<{ x: number, z: number }>
}

interface StageScene {
  background: string
  ground: boolean
  lightIntensity: number
  lightColor: string
}

interface StageDoc {
  objects: StageObject[]
  camera: { x: number, y: number, z: number, tx: number, ty: number, tz: number, fov: number }
  shotId: string
  duration?: number
  cameraKeys?: CameraKeyframe[]
  scene?: StageScene
}

function keyOf(projectId: string): string {
  return `dsh-aidrama:director:${projectId}`
}

function colorOf(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  return `hsl(${hash % 360} 45% 58%)`
}

function defaultDoc(project: Project): StageDoc {
  const objects: StageObject[] = []
  project.characters.forEach((character, index) => {
    objects.push({
      id: `obj:${character.id}`,
      kind: 'character',
      refId: character.id,
      name: character.name,
      x: (index - (project.characters.length - 1) / 2) * 1.4,
      y: 0,
      z: 0,
      rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      color: colorOf(character.id),
    })
  })
  project.props.slice(0, 6).forEach((prop, index) => {
    objects.push({
      id: `obj:${prop.id}`,
      kind: 'prop',
      refId: prop.id,
      name: prop.name,
      x: -2.4 + index * 0.5,
      y: 0.35,
      z: -1.4,
      rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
      color: '#9a8f78',
    })
  })
  return {
    objects,
    camera: { x: 0, y: 4.4, z: 14, tx: 0, ty: 1, tz: 0, fov: 50 },
    shotId: project.episodes[0]?.shots[0]?.id ?? '',
    scene: { background: '#161922', ground: true, lightIntensity: 2.3, lightColor: '#fff2dc' },
  }
}

function readDoc(project: Project): StageDoc {
  const fallback = defaultDoc(project)
  const persisted = project.director
  if (persisted !== null && typeof persisted === 'object') {
    const parsed = persisted as StageDoc
    if (Array.isArray(parsed.objects) && parsed.camera !== undefined) {
      return { ...fallback, ...parsed, scene: { ...fallback.scene!, ...parsed.scene } }
    }
  }
  try {
    const raw = window.localStorage.getItem(keyOf(project.id))
    if (raw !== null) {
      const parsed = JSON.parse(raw) as StageDoc
      if (Array.isArray(parsed.objects) && parsed.camera !== undefined) {
        return { ...fallback, ...parsed, scene: { ...fallback.scene!, ...parsed.scene } }
      }
    }
  } catch {
    // ignore broken local layout
  }
  return fallback
}

function spriteLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context !== null) {
    context.fillStyle = 'rgba(0,0,0,.62)'
    context.roundRect(4, 4, 248, 56, 12)
    context.fill()
    context.fillStyle = '#fff'
    context.font = '28px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text.slice(0, 10), 128, 32)
  }
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.62, 0.155, 1)
  return sprite
}

function buildObject(object: StageObject): THREE.Object3D {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: object.color, roughness: 0.72, metalness: 0.04 })
  if (object.kind === 'character') {
    const pose = object.pose ?? 'stand'
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.95, 6, 12), material)
    body.position.y = pose === 'kneel' ? 0.62 : pose === 'sit' ? 0.7 : pose === 'fall' ? 0.42 : 0.9
    body.castShadow = true
    group.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), material)
    head.position.y = pose === 'kneel' ? 1.34 : pose === 'sit' ? 1.42 : pose === 'fall' ? 0.95 : 1.62
    head.castShadow = true
    group.add(head)
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.24), material)
    shoulders.position.y = pose === 'kneel' ? 1.1 : pose === 'sit' ? 1.18 : pose === 'fall' ? 0.82 : 1.38
    group.add(shoulders)
    const limbMaterial = new THREE.MeshStandardMaterial({ color: object.color, roughness: 0.78 })
    const makeLimb = (length: number, radius = 0.075) => {
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.8, length, 8), limbMaterial)
      limb.position.y = -length / 2
      limb.castShadow = true
      return limb
    }
    const armL = new THREE.Group()
    armL.position.set(-0.36, pose === 'kneel' ? 1.1 : pose === 'sit' ? 1.18 : 1.38, 0)
    armL.add(makeLimb(0.7))
    const armR = new THREE.Group()
    armR.position.set(0.36, pose === 'kneel' ? 1.1 : pose === 'sit' ? 1.18 : 1.38, 0)
    armR.add(makeLimb(0.7))
    const legL = new THREE.Group()
    legL.position.set(-0.14, pose === 'kneel' ? 0.55 : pose === 'sit' ? 0.62 : 0.55, 0)
    legL.add(makeLimb(0.85, 0.095))
    const legR = new THREE.Group()
    legR.position.set(0.14, pose === 'kneel' ? 0.55 : pose === 'sit' ? 0.62 : 0.55, 0)
    legR.add(makeLimb(0.85, 0.095))
    if (pose === 'walk') {
      armL.rotation.x = 0.55
      armR.rotation.x = -0.55
      legL.rotation.x = -0.45
      legR.rotation.x = 0.45
    } else if (pose === 'run') {
      armL.rotation.x = 1.05
      armR.rotation.x = -1.05
      legL.rotation.x = -0.8
      legR.rotation.x = 0.8
    } else if (pose === 'sit') {
      armL.rotation.x = -0.25
      armR.rotation.x = -0.25
      legL.rotation.x = -1.35
      legR.rotation.x = -1.35
    } else if (pose === 'kneel') {
      armL.rotation.x = 0.35
      armR.rotation.x = 0.35
      legL.rotation.x = 1.15
      legR.rotation.x = -0.55
    } else if (pose === 'wave') {
      armL.rotation.z = 0.1
      armR.rotation.z = -2.15
    } else if (pose === 'punch') {
      armL.rotation.x = 0.6
      armR.rotation.x = -1.5
      legL.rotation.x = -0.25
      legR.rotation.x = 0.25
    } else if (pose === 'fall') {
      group.rotation.z = Math.PI / 2.2
      armL.rotation.z = -0.35
      armR.rotation.z = 0.35
    } else {
      armL.rotation.z = 0.08
      armR.rotation.z = -0.08
    }
    group.add(armL, armR, legL, legR)
  } else if (object.kind === 'scene') {
    const platform = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 5), material)
    platform.position.y = 0.04
    platform.receiveShadow = true
    group.add(platform)
  } else {
    const size = object.kind === 'prop' ? 0.55 : 0.8
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material)
    mesh.position.y = size / 2
    mesh.castShadow = true
    group.add(mesh)
  }
  const label = spriteLabel(object.name)
  if (object.kind === 'character') {
    label.scale.set(0.5, 0.125, 1)
    label.position.y = 2.35
    group.add(label)
  }
  group.position.set(object.x, object.y, object.z)
  group.rotation.set(object.rx, object.ry, object.rz)
  group.scale.set(object.sx, object.sy, object.sz)
  group.visible = object.visible !== false
  group.userData.objectId = object.id
  group.userData.locked = object.locked === true
  return group
}

export function DirectorPanel(props: { project: Project, mutate: (fn: (project: Project) => void) => void }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene>()
  const cameraRef = useRef<THREE.PerspectiveCamera>()
  const shotCameraRef = useRef<THREE.PerspectiveCamera>()
  const controlsRef = useRef<OrbitControls>()
  const transformRef = useRef<TransformControls>()
  const rendererRef = useRef<THREE.WebGLRenderer>()
  const groundRef = useRef<THREE.Mesh>()
  const keyLightRef = useRef<THREE.DirectionalLight>()
  const meshesRef = useRef(new Map<string, THREE.Object3D>())
  const [doc, setDoc] = useState<StageDoc>(() => readDoc(props.project))
  const [selectedId, setSelectedId] = useState<string>()
  const [ready, setReady] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [history, setHistory] = useState<StageDoc[]>([])
  const [future, setFuture] = useState<StageDoc[]>([])
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [trailMode, setTrailMode] = useState(false)
  const trailModeRef = useRef(false)
  trailModeRef.current = trailMode
  const addTrailPointRef = useRef<(x: number, z: number) => void>(() => {})
  const trailGroupRef = useRef<THREE.Group>()
  const duration = doc.duration ?? 150
  const selected = useMemo(() => doc.objects.find(object => object.id === selectedId), [doc.objects, selectedId])
  const shots = useMemo(() => props.project.episodes.flatMap(episode => episode.shots.map(shot => ({ ...shot, episodeId: episode.id }))), [props.project.episodes])
  const selectedShot = shots.find(shot => shot.id === doc.shotId)

  useEffect(() => {
    setDoc(readDoc(props.project))
    setSelectedId(undefined)
  }, [props.project.id])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#161922')
    scene.fog = new THREE.Fog('#161922', 10, 28)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100)
    camera.position.set(3.6, 2.6, 5.4)
    cameraRef.current = camera
    const shotCamera = new THREE.PerspectiveCamera(doc.camera.fov, 9 / 16, 0.05, 100)
    shotCamera.position.set(doc.camera.x, doc.camera.y, doc.camera.z)
    shotCamera.lookAt(doc.camera.tx, doc.camera.ty, doc.camera.tz)
    shotCameraRef.current = shotCamera

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    rendererRef.current = renderer

    const grid = new THREE.GridHelper(24, 24, '#5b6475', '#2a3040')
    grid.position.y = 0.01
    scene.add(grid)
    const trailGroup = new THREE.Group()
    scene.add(trailGroup)
    trailGroupRef.current = trailGroup
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ color: '#202632', roughness: 0.95 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    groundRef.current = ground
    scene.add(new THREE.HemisphereLight('#b8c7e6', '#141820', 1.5))
    const key = new THREE.DirectionalLight('#fff2dc', 2.3)
    key.position.set(4, 7, 5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key)
    keyLightRef.current = key
    const rim = new THREE.DirectionalLight('#6e8dff', 1.1)
    rim.position.set(-5, 3, -4)
    scene.add(rim)

    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.target.set(0, 1, 0)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.08
    orbit.minDistance = 1.2
    orbit.maxDistance = 24
    controlsRef.current = orbit

    const transform = new TransformControls(camera, renderer.domElement)
    transform.setSize(0.8)
    transform.addEventListener('dragging-changed', event => { orbit.enabled = event.value !== true })
    const syncObject = () => {
      const mesh = transform.object
      if (mesh === null || mesh === undefined) return
      const objectId = mesh.userData.objectId as string | undefined
      if (objectId === undefined) return
      setDoc(previous => {
        const next = {
          ...previous,
          objects: previous.objects.map(object => object.id === objectId ? {
            ...object,
            x: mesh.position.x,
            y: mesh.position.y,
            z: mesh.position.z,
            rx: mesh.rotation.x,
            ry: mesh.rotation.y,
            rz: mesh.rotation.z,
            sx: mesh.scale.x,
            sy: mesh.scale.y,
            sz: mesh.scale.z,
          } : object),
        }
        try {
          window.localStorage.setItem(keyOf(props.project.id), JSON.stringify(next))
        } catch {
          // ignore
        }
        return next
      })
    }
    transform.addEventListener('objectChange', syncObject)
    scene.add(transform.getHelper())
    transformRef.current = transform

    const ray = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      ray.setFromCamera(pointer, camera)
      if (trailModeRef.current) {
        const ground = groundRef.current
        if (ground !== undefined) {
          const groundHit = ray.intersectObject(ground, false)[0]
          if (groundHit !== undefined) addTrailPointRef.current(groundHit.point.x, groundHit.point.z)
        }
        return
      }
      const hits = ray.intersectObjects([...meshesRef.current.values()], true)
      const hit = hits[0]
      if (hit === undefined) {
        setSelectedId(undefined)
        return
      }
      let target: THREE.Object3D | null = hit.object
      while (target !== null && target.userData.objectId === undefined) target = target.parent
      if (target !== null && target.userData.locked !== true) setSelectedId(target.userData.objectId as string)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const resize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      if (width === 0 || height === 0) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      orbit.update()
      const width = mount.clientWidth
      const height = mount.clientHeight
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, width, height)
      renderer.render(scene, camera)
      const previewWidth = Math.min(300, Math.max(180, width * 0.28))
      const previewHeight = previewWidth * 9 / 16
      const padding = 14
      shotCamera.aspect = 9 / 16
      shotCamera.updateProjectionMatrix()
      renderer.setScissorTest(true)
      renderer.setScissor(width - previewWidth - padding, height - previewHeight - padding, previewWidth, previewHeight)
      renderer.setViewport(width - previewWidth - padding, height - previewHeight - padding, previewWidth, previewHeight)
      renderer.render(scene, shotCamera)
      renderer.setScissorTest(false)
    }
    animate()
    setReady(true)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      transform.dispose()
      orbit.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      setReady(false)
    }
  }, [props.project.id])

  useEffect(() => {
    const scene = sceneRef.current
    if (scene === undefined) return
    for (const mesh of meshesRef.current.values()) scene.remove(mesh)
    meshesRef.current.clear()
    for (const object of doc.objects) {
      const mesh = buildObject(object)
      scene.add(mesh)
      meshesRef.current.set(object.id, mesh)
    }
  }, [doc.objects, ready])

  useEffect(() => {
    const scene = sceneRef.current
    if (scene === undefined || doc.scene === undefined) return
    scene.background = new THREE.Color(doc.scene.background)
    scene.fog = new THREE.Fog(doc.scene.background, 10, 28)
    if (groundRef.current !== undefined) groundRef.current.visible = doc.scene.ground
    if (keyLightRef.current !== undefined) {
      keyLightRef.current.intensity = doc.scene.lightIntensity
      keyLightRef.current.color.set(doc.scene.lightColor)
    }
  }, [doc.scene, ready])

  useEffect(() => {
    const group = trailGroupRef.current
    if (group === undefined) return
    group.clear()
    const object = selectedId === undefined ? undefined : doc.objects.find(item => item.id === selectedId)
    if (object === undefined || (object.trail ?? []).length < 2) return
    const points = (object.trail ?? []).map(point => new THREE.Vector3(point.x, 0.04, point.z))
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#ffd166' }))
    group.add(line)
    for (const point of points) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffd166' }))
      marker.position.copy(point)
      group.add(marker)
    }
  }, [doc.objects, selectedId, ready])

  useEffect(() => {
    const transform = transformRef.current
    if (transform === undefined) return
    const mesh = selectedId === undefined ? undefined : meshesRef.current.get(selectedId)
    if (mesh === undefined || mesh.userData.locked === true) transform.detach()
    else transform.attach(mesh)
  }, [selectedId, doc.objects, ready])

  useEffect(() => {
    const camera = shotCameraRef.current
    if (camera === undefined) return
    const keys = (doc.cameraKeys ?? []).slice().sort((a, b) => a.frame - b.frame)
    if (keys.length === 0) {
      camera.position.set(doc.camera.x, doc.camera.y, doc.camera.z)
      camera.fov = doc.camera.fov
      camera.lookAt(doc.camera.tx, doc.camera.ty, doc.camera.tz)
    } else {
      const before = [...keys].reverse().find(key => key.frame <= frame) ?? keys[0]!
      const after = keys.find(key => key.frame >= frame) ?? keys[keys.length - 1]!
      const span = Math.max(1, after.frame - before.frame)
      const t = Math.max(0, Math.min(1, (frame - before.frame) / span))
      camera.position.set(
        before.x + (after.x - before.x) * t,
        before.y + (after.y - before.y) * t,
        before.z + (after.z - before.z) * t,
      )
      camera.fov = before.fov + (after.fov - before.fov) * t
      camera.lookAt(
        before.tx + (after.tx - before.tx) * t,
        before.ty + (after.ty - before.ty) * t,
        before.tz + (after.tz - before.tz) * t,
      )
    }
    camera.updateProjectionMatrix()
  }, [doc.camera, doc.cameraKeys, frame])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setFrame(current => current >= duration ? 0 : current + 1)
    }, 33)
    return () => window.clearInterval(timer)
  }, [playing, duration])

  useEffect(() => {
    for (const object of doc.objects) {
      const mesh = meshesRef.current.get(object.id)
      if (mesh === undefined) continue
      const keys = (object.keyframes ?? []).slice().sort((a, b) => a.frame - b.frame)
      if (keys.length === 0) {
        mesh.position.set(object.x, object.y, object.z)
        mesh.rotation.set(object.rx, object.ry, object.rz)
        continue
      }
      const before = [...keys].reverse().find(key => key.frame <= frame) ?? keys[0]!
      const after = keys.find(key => key.frame >= frame) ?? keys[keys.length - 1]!
      const span = Math.max(1, after.frame - before.frame)
      const t = Math.max(0, Math.min(1, (frame - before.frame) / span))
      mesh.position.set(
        before.x + (after.x - before.x) * t,
        before.y + (after.y - before.y) * t,
        before.z + (after.z - before.z) * t,
      )
      mesh.rotation.set(
        before.rx + (after.rx - before.rx) * t,
        before.ry + (after.ry - before.ry) * t,
        before.rz + (after.rz - before.rz) * t,
      )
    }
  }, [frame, doc.objects, ready])

  const persist = (next: StageDoc) => {
    setHistory(previous => [...previous, doc].slice(-30))
    setFuture([])
    setDoc(next)
    props.mutate(project => { project.director = next })
    try {
      window.localStorage.setItem(keyOf(props.project.id), JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const undo = () => {
    const previous = history[history.length - 1]
    if (previous === undefined) return
    setHistory(items => items.slice(0, -1))
    setFuture(items => [doc, ...items].slice(0, 30))
    setDoc(previous)
    try {
      window.localStorage.setItem(keyOf(props.project.id), JSON.stringify(previous))
    } catch {
      // ignore
    }
  }

  const redo = () => {
    const next = future[0]
    if (next === undefined) return
    setFuture(items => items.slice(1))
    setHistory(items => [...items, doc].slice(-30))
    setDoc(next)
    try {
      window.localStorage.setItem(keyOf(props.project.id), JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const updateSelected = (patch: Partial<StageObject>) => {
    if (selectedId === undefined) return
    persist({ ...doc, objects: doc.objects.map(object => object.id === selectedId ? { ...object, ...patch } : object) })
  }

  const addKeyframe = (atFrame = frame) => {
    if (selectedId === undefined) return
    const object = doc.objects.find(item => item.id === selectedId)
    if (object === undefined) return
    const key: StageKeyframe = {
      frame: Math.round(atFrame), x: object.x, y: object.y, z: object.z,
      rx: object.rx, ry: object.ry, rz: object.rz, pose: object.pose,
    }
    const keys = (object.keyframes ?? []).filter(item => item.frame !== key.frame)
    keys.push(key)
    persist({ ...doc, objects: doc.objects.map(item => item.id === selectedId ? { ...item, keyframes: keys } : item) })
  }

  const moveKeyframes = (distance: number) => {
    if (selectedId === undefined) return
    const object = doc.objects.find(item => item.id === selectedId)
    if (object === undefined) return
    const start = frame
    const end = Math.min(duration, frame + 30)
    const make = (at: number, z: number): StageKeyframe => ({
      frame: Math.round(at), x: object.x, y: object.y, z: object.z + z,
      rx: object.rx, ry: object.ry, rz: object.rz, pose: object.pose,
    })
    const keys = [...(object.keyframes ?? []).filter(item => item.frame !== start && item.frame !== end), make(start, 0), make(end, distance)]
    persist({ ...doc, objects: doc.objects.map(item => item.id === selectedId ? { ...item, keyframes: keys } : item) })
  }

  const turnKeyframes = () => {
    if (selectedId === undefined) return
    const object = doc.objects.find(item => item.id === selectedId)
    if (object === undefined) return
    const start = frame
    const end = Math.min(duration, frame + 24)
    const keys = [
      ...(object.keyframes ?? []).filter(item => item.frame !== start && item.frame !== end),
      { frame: Math.round(start), x: object.x, y: object.y, z: object.z, rx: object.rx, ry: object.ry, rz: object.rz, pose: object.pose },
      { frame: Math.round(end), x: object.x, y: object.y, z: object.z, rx: object.rx, ry: object.ry + Math.PI / 2, rz: object.rz, pose: object.pose },
    ]
    persist({ ...doc, objects: doc.objects.map(item => item.id === selectedId ? { ...item, keyframes: keys } : item) })
  }

  const clearKeyframes = () => {
    if (selectedId === undefined) return
    persist({ ...doc, objects: doc.objects.map(item => item.id === selectedId ? { ...item, keyframes: [] } : item) })
  }

  const addTrailPoint = (x: number, z: number) => {
    if (selectedId === undefined) return
    persist({
      ...doc,
      objects: doc.objects.map(item => item.id === selectedId
        ? { ...item, trail: [...(item.trail ?? []), { x, z }] }
        : item),
    })
  }
  addTrailPointRef.current = addTrailPoint

  const applyTrail = () => {
    const object = selected === undefined ? undefined : doc.objects.find(item => item.id === selected.id)
    if (object === undefined || (object.trail ?? []).length < 2) return
    const points = object.trail ?? []
    const keys: StageKeyframe[] = points.map((point, index) => ({
      frame: Math.min(duration, Math.round(frame + index * Math.max(8, Math.round(36 / points.length)))),
      x: point.x, y: object.y, z: point.z,
      rx: object.rx, ry: object.ry, rz: object.rz, pose: 'walk',
    }))
    persist({
      ...doc,
      objects: doc.objects.map(item => item.id === object.id
        ? { ...item, pose: 'walk', keyframes: [...(item.keyframes ?? []).filter(key => !keys.some(next => next.frame === key.frame)), ...keys].sort((a, b) => a.frame - b.frame) }
        : item),
    })
    setTrailMode(false)
  }

  const clearTrail = () => {
    if (selectedId === undefined) return
    persist({ ...doc, objects: doc.objects.map(item => item.id === selectedId ? { ...item, trail: [] } : item) })
  }

  const addCharacter = (id: string) => {
    const character = props.project.characters.find(item => item.id === id)
    if (character === undefined) return
    const object: StageObject = {
      id: `obj:${character.id}:${Date.now()}`,
      kind: 'character', refId: character.id, name: character.name,
      x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, color: colorOf(character.id),
    }
    persist({ ...doc, objects: [...doc.objects, object] })
    setSelectedId(object.id)
  }

  const addBox = () => {
    const object: StageObject = {
      id: `obj:box:${Date.now()}`, kind: 'box', refId: '', name: '基础体',
      x: 0, y: 0.4, z: -2, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, color: '#8d8574',
    }
    persist({ ...doc, objects: [...doc.objects, object] })
    setSelectedId(object.id)
  }

  const addProp = (refId: string) => {
    const prop = props.project.props.find(item => item.id === refId)
    if (prop === undefined) return
    const object: StageObject = {
      id: `obj:${prop.id}:${Date.now()}`,
      kind: 'prop', refId: prop.id, name: prop.name,
      x: 0, y: 0.35, z: -1.2, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, color: '#9a8f78',
    }
    persist({ ...doc, objects: [...doc.objects, object] })
    setSelectedId(object.id)
  }

  const saveCamera = () => {
    const camera = cameraRef.current
    if (camera === undefined) return
    const target = controlsRef.current?.target ?? new THREE.Vector3(0, 1, 0)
    persist({ ...doc, camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, tx: target.x, ty: target.y, tz: target.z, fov: camera.fov } })
  }

  const addCameraKeyframe = () => {
    const camera = cameraRef.current
    if (camera === undefined) return
    const target = controlsRef.current?.target ?? new THREE.Vector3(0, 1, 0)
    const key: CameraKeyframe = {
      frame: Math.round(frame), x: camera.position.x, y: camera.position.y, z: camera.position.z,
      tx: target.x, ty: target.y, tz: target.z, fov: camera.fov,
    }
    const keys = [...(doc.cameraKeys ?? []).filter(item => item.frame !== key.frame), key].sort((a, b) => a.frame - b.frame)
    persist({ ...doc, camera: { ...doc.camera, ...{ x: key.x, y: key.y, z: key.z, tx: key.tx, ty: key.ty, tz: key.tz, fov: key.fov } }, cameraKeys: keys })
  }

  const clearCameraKeys = () => persist({ ...doc, cameraKeys: [] })

  const renderShotDataUrl = (): string | undefined => {
    const scene = sceneRef.current
    const camera = shotCameraRef.current
    if (scene === undefined || camera === undefined) return undefined
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(720, 1280, false)
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')
    renderer.dispose()
    return dataUrl
  }

  const snapshot = () => {
    const data = renderShotDataUrl()
    if (data === undefined) return
    const link = document.createElement('a')
    link.href = data
    link.download = `3d-camera-${Date.now()}.png`
    link.click()
  }

  const record = (toCanvas = false) => {
    const renderer = rendererRef.current
    if (renderer === undefined) return
    if (typeof MediaRecorder === 'undefined') {
      window.alert('当前浏览器不支持 MediaRecorder，无法录制。')
      return
    }
    const stream = renderer.domElement.captureStream(30)
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      if (toCanvas) {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result)
          const storage = `dsh-aidrama:canvas:${props.project.id}`
          try {
            const persisted = props.project.canvas
            const raw = persisted !== null && typeof persisted === 'object' ? JSON.stringify(persisted) : window.localStorage.getItem(storage)
            const board = raw === null ? { nodes: [], edges: [] as Array<{ id: string, from: string, to: string }> } : JSON.parse(raw) as { nodes: Array<Record<string, unknown>>, edges: Array<{ id: string, from: string, to: string }> }
            if (!Array.isArray(board.nodes)) board.nodes = []
            if (!Array.isArray(board.edges)) board.edges = []
            board.nodes.push({
              id: `video:director-${Date.now()}`,
              kind: 'shot',
              refId: doc.shotId,
              x: 90 + 4 * 260,
              y: 300 + board.nodes.length * 12,
              w: 260,
              h: 190,
              text: '3D 录屏参考',
              mediaType: 'video',
              dataUrl,
            })
            props.mutate(project => { project.canvas = board })
            window.localStorage.setItem(storage, JSON.stringify(board))
            window.alert('录屏已发送到画布。')
          } catch {
            window.alert('录屏写入画布失败。')
          }
        }
        reader.readAsDataURL(blob)
        return
      }
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `3d-director-${Date.now()}.webm`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 30_000)
    }
    setFrame(0)
    setPlaying(true)
    recorder.start()
    window.setTimeout(() => {
      recorder.stop()
      setPlaying(false)
    }, 5000)
  }

  const sendToCanvas = () => {
    const dataUrl = renderShotDataUrl()
    if (dataUrl === undefined) return
    const storage = `dsh-aidrama:canvas:${props.project.id}`
    try {
      const persisted = props.project.canvas
      const raw = persisted !== null && typeof persisted === 'object'
        ? JSON.stringify(persisted)
        : window.localStorage.getItem(storage)
      const board = raw === null
        ? { nodes: [], edges: [] as Array<{ id: string, from: string, to: string }> }
        : JSON.parse(raw) as { nodes: Array<Record<string, unknown>>, edges: Array<{ id: string, from: string, to: string }> }
      if (!Array.isArray(board.nodes)) board.nodes = []
      if (!Array.isArray(board.edges)) board.edges = []
      board.nodes.push({
        id: `shot:director-${Date.now()}`,
        kind: 'shot',
        refId: doc.shotId,
        x: 90 + 4 * 260,
        y: 300 + board.nodes.length * 12,
        w: 260,
        h: 190,
        text: `3D 构图参考${selectedShot === undefined ? '' : ` · ${selectedShot.id}`}`,
        dataUrl,
      })
      props.mutate(project => { project.canvas = board })
      window.localStorage.setItem(storage, JSON.stringify(board))
      window.alert('已发送到画布；切到「画布」即可看到这个构图节点。')
    } catch {
      window.alert('画布写入失败，请先打开一次「画布」。')
    }
  }

  type CameraPreset = 'front' | 'side' | 'top' | 'overShoulder' | 'frontClose' | 'frontWide' | 'sideClose' | 'backMedium' | 'top45' | 'lowAngle' | 'lowWide' | 'overShoulderRight' | 'bird' | 'dutch'

  type CameraMove = 'fixed' | 'pushIn' | 'pullOut' | 'panLeft' | 'panRight' | 'rise' | 'orbit'

  const applyCameraMove = (move: CameraMove) => {
    const camera = cameraRef.current
    if (camera === undefined) return
    const target = (controlsRef.current?.target ?? new THREE.Vector3(0, 1, 0)).clone()
    const position = camera.position.clone()
    const direction = target.clone().sub(position).normalize()
    const nextPosition = position.clone()
    const nextTarget = target.clone()
    if (move === 'pushIn') nextPosition.add(direction.multiplyScalar(1.1))
    if (move === 'pullOut') nextPosition.sub(direction.multiplyScalar(1.1))
    if (move === 'panLeft') nextTarget.x -= 1
    if (move === 'panRight') nextTarget.x += 1
    if (move === 'rise') nextPosition.y += 1
    if (move === 'orbit') {
      const offset = position.clone().sub(target)
      const angle = Math.PI / 4
      const x = offset.x * Math.cos(angle) - offset.z * Math.sin(angle)
      const z = offset.x * Math.sin(angle) + offset.z * Math.cos(angle)
      nextPosition.set(target.x + x, position.y, target.z + z)
    }
    const start = Math.round(frame)
    const end = Math.min(duration, start + 30)
    const keyAt = (at: number, pos: THREE.Vector3, look: THREE.Vector3): CameraKeyframe => ({
      frame: at, x: pos.x, y: pos.y, z: pos.z, tx: look.x, ty: look.y, tz: look.z, fov: camera.fov,
    })
    const keys = [
      ...(doc.cameraKeys ?? []).filter(key => key.frame !== start && key.frame !== end),
      keyAt(start, position, target),
      keyAt(end, nextPosition, nextTarget),
    ].sort((a, b) => a.frame - b.frame)
    persist({
      ...doc,
      camera: { x: nextPosition.x, y: nextPosition.y, z: nextPosition.z, tx: nextTarget.x, ty: nextTarget.y, tz: nextTarget.z, fov: camera.fov },
      cameraKeys: keys,
    })
  }

  const cameraPreset = (preset: CameraPreset) => {
    const camera = cameraRef.current
    if (camera === undefined) return
    const target = controlsRef.current?.target ?? new THREE.Vector3(0, 1, 0)
    const presets: Record<CameraPreset, { x: number, y: number, z: number, fov: number }> = {
      front: { x: 0, y: 1.6, z: 4.8, fov: 42 },
      side: { x: 4.8, y: 1.6, z: 0, fov: 42 },
      top: { x: 0.1, y: 5.8, z: 0.1, fov: 42 },
      overShoulder: { x: 1.4, y: 2.1, z: 2.8, fov: 38 },
      frontClose: { x: 0, y: 1.55, z: 2.5, fov: 34 },
      frontWide: { x: 0, y: 1.7, z: 7.5, fov: 48 },
      sideClose: { x: 2.5, y: 1.6, z: 0.4, fov: 34 },
      backMedium: { x: 0, y: 1.6, z: -4.8, fov: 42 },
      top45: { x: 3.2, y: 4.2, z: 3.2, fov: 44 },
      lowAngle: { x: 0.8, y: 0.65, z: 3.4, fov: 50 },
      lowWide: { x: 0.4, y: 0.45, z: 5.2, fov: 58 },
      overShoulderRight: { x: -1.4, y: 2.1, z: 2.8, fov: 38 },
      bird: { x: 0.01, y: 9, z: 0.01, fov: 40 },
      dutch: { x: 2.8, y: 2.2, z: 3.2, fov: 46 },
    }
    const next = presets[preset]
    camera.position.set(next.x, next.y, next.z)
    camera.fov = next.fov
    camera.lookAt(target)
    orbitTarget(target)
    persist({ ...doc, camera: { x: next.x, y: next.y, z: next.z, tx: target.x, ty: target.y, tz: target.z, fov: next.fov } })
  }

  const orbitTarget = (target: THREE.Vector3) => {
    const orbit = controlsRef.current
    if (orbit === undefined) return
    orbit.target.copy(target)
    orbit.update()
  }

  const reset = () => {
    const next = defaultDoc(props.project)
    persist(next)
    setSelectedId(undefined)
  }

  return (
    <div style={fullscreen
      ? { position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--dsw-alias-bg-base, #101114)', padding: 10, display: 'grid', gridTemplateColumns: '220px minmax(0,1fr) 250px', gap: 10 }
      : { display: 'grid', gridTemplateColumns: '220px minmax(0,1fr) 250px', gap: 10, minHeight: 560, height: '100%' }}>
      <div className="ad-col" style={{ minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
        <div className="ad-row" style={{ justifyContent: 'space-between' }}>
          <h3 className="ad-h2" style={{ margin: 0 }}>对象</h3>
          <button type="button" className="ad-btn" onClick={addBox}>+ 基础体</button>
        </div>
        <div className="ad-col" style={{ gap: 4, marginTop: 6 }}>
          {doc.objects.map(object => (
            <div key={object.id} className="ad-row" style={{ gap: 3 }}>
              <button type="button" className="ad-btn" data-kind={selectedId === object.id ? 'primary' : undefined}
                style={{ justifyContent: 'space-between', flex: 1, minWidth: 0 }}
                onClick={() => setSelectedId(object.id)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: object.visible === false ? .45 : 1 }}>{object.name}</span>
                <span className="ad-tiny" style={{ opacity: .55 }}>{object.kind}</span>
              </button>
              <button type="button" className="ad-btn" title={object.visible === false ? '显示' : '隐藏'} style={{ width: 30, padding: 0 }}
                onClick={() => persist({ ...doc, objects: doc.objects.map(item => item.id === object.id ? { ...item, visible: item.visible === false } : item) })}>{object.visible === false ? '○' : '●'}</button>
              <button type="button" className="ad-btn" title={object.locked ? '解锁' : '锁定'} style={{ width: 30, padding: 0 }}
                onClick={() => persist({ ...doc, objects: doc.objects.map(item => item.id === object.id ? { ...item, locked: item.locked !== true } : item) })}>{object.locked ? '锁' : '开'}</button>
            </div>
          ))}
        </div>
        <h3 className="ad-h2" style={{ marginTop: 12 }}>加入角色</h3>
        <div className="ad-col" style={{ gap: 4 }}>
          {props.project.characters.map(character => (
            <button key={character.id} type="button" className="ad-btn" style={{ justifyContent: 'space-between' }} onClick={() => addCharacter(character.id)}>
              <span>{character.name}</span><span className="ad-tiny" style={{ opacity: .55 }}>+</span>
            </button>
          ))}
        </div>
        <h3 className="ad-h2" style={{ marginTop: 12 }}>加入道具</h3>
        <div className="ad-col" style={{ gap: 4 }}>
          {props.project.props.map(prop => (
            <button key={prop.id} type="button" className="ad-btn" style={{ justifyContent: 'space-between' }} onClick={() => addProp(prop.id)}>
              <span>{prop.name}</span><span className="ad-tiny" style={{ opacity: .55 }}>+</span>
            </button>
          ))}
        </div>
        <h3 className="ad-h2" style={{ marginTop: 12 }}>动作库</h3>
        <div className="ad-tiny ad-muted" style={{ marginBottom: 4 }}>选角色后套动作；动作会写进当前帧</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {([['stand', '站立'], ['walk', '行走'], ['run', '奔跑'], ['sit', '坐下'], ['kneel', '跪下']] as const).map(([pose, label]) => (
            <button key={pose} type="button" className="ad-btn" disabled={selected === undefined || selected.kind !== 'character'}
              onClick={() => { updateSelected({ pose }); addKeyframe() }}>{label}</button>
          ))}
          <button type="button" className="ad-btn" disabled={selected === undefined} onClick={() => moveKeyframes(1.4)}>前进</button>
          <button type="button" className="ad-btn" disabled={selected === undefined} onClick={() => moveKeyframes(-1.4)}>后退</button>
          <button type="button" className="ad-btn" disabled={selected === undefined} onClick={turnKeyframes}>转身</button>
          <button type="button" className="ad-btn" disabled={selected === undefined} onClick={() => addKeyframe()}>加关键帧</button>
          <button type="button" className="ad-btn" disabled={selected === undefined} onClick={clearKeyframes}>清关键帧</button>
          <button type="button" className="ad-btn" data-kind={trailMode ? 'primary' : undefined} disabled={selected === undefined} onClick={() => setTrailMode(value => !value)}>{trailMode ? '点地面绘制…' : '轨迹'}</button>
          <button type="button" className="ad-btn" disabled={(selected?.trail ?? []).length < 2} onClick={applyTrail}>应用轨迹</button>
          <button type="button" className="ad-btn" disabled={(selected?.trail ?? []).length === 0} onClick={clearTrail}>清轨迹</button>
        </div>
        <select aria-label="更多动作" defaultValue="" onChange={event => {
          const value = event.target.value as PoseId | 'turn' | ''
          if (value === 'turn') turnKeyframes()
          else if (value !== '') { updateSelected({ pose: value }); addKeyframe() }
          event.target.value = ''
        }} style={{ width: '100%', height: 28, marginTop: 4, borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}>
          <option value="">更多动作…</option>
          <option value="wave">挥手</option>
          <option value="punch">挥拳</option>
          <option value="fall">倒地</option>
          <option value="turn">转身（24 帧）</option>
        </select>
        <div className="ad-row" style={{ marginTop: 10, gap: 4 }}>
          <button type="button" className="ad-btn" style={{ flex: 1 }} disabled={history.length === 0} onClick={undo}>撤销</button>
          <button type="button" className="ad-btn" style={{ flex: 1 }} disabled={future.length === 0} onClick={redo}>重做</button>
        </div>
        <button type="button" className="ad-btn" style={{ marginTop: 6 }} onClick={reset}>重置导演台</button>
      </div>

      <div style={{ position: 'relative', minHeight: 0, overflow: 'hidden', borderRadius: 10, border: '1px solid color-mix(in srgb, currentColor 15%, transparent)' }}>
        <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
        {doc.objects.length === 0 ? (
          <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
            <div className="ad-card" style={{ padding: 16, maxWidth: 300, textAlign: 'center' }}>
              <b style={{ fontSize: 13 }}>还没有对象</b>
              <p className="ad-tiny ad-muted" style={{ margin: '6px 0 0' }}>从左侧加入角色、道具或基础体，再摆站位和机位。</p>
            </div>
          </div>
        ) : null}
        <div className="ad-row" style={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 2, gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="ad-btn" onClick={saveCamera}>当前视角建机位</button>
          <button type="button" className="ad-btn" onClick={() => cameraPreset('front')}>正面</button>
          <button type="button" className="ad-btn" onClick={() => cameraPreset('side')}>侧面</button>
          <button type="button" className="ad-btn" onClick={() => cameraPreset('top')}>俯拍</button>
          <button type="button" className="ad-btn" onClick={() => cameraPreset('overShoulder')}>过肩</button>
          <select aria-label="完整机位预设" defaultValue="" onChange={event => { if (event.target.value !== '') cameraPreset(event.target.value as CameraPreset); event.target.value = '' }}
            style={{ height: 30, maxWidth: 120, borderRadius: 7, background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}>
            <option value="">更多机位…</option>
            <option value="frontClose">正面特写</option>
            <option value="frontWide">正面全景</option>
            <option value="sideClose">侧面近景</option>
            <option value="backMedium">背面中景</option>
            <option value="top45">45° 俯拍</option>
            <option value="lowAngle">低角度仰拍</option>
            <option value="lowWide">低角度广角</option>
            <option value="overShoulderRight">过肩（右）</option>
            <option value="bird">鸟瞰</option>
            <option value="dutch">荷兰角</option>
          </select>
          <span className="ad-tiny" style={{ alignSelf: 'center', opacity: .7 }}>左键旋转 · 滚轮缩放 · 右键平移</span>
        </div>
        <div className="ad-tiny" style={{ position: 'absolute', right: 12, bottom: 62, zIndex: 2, padding: '3px 7px', borderRadius: 5, background: 'rgba(0,0,0,.5)', color: '#fff' }}>
          机位预览{selectedShot === undefined ? '' : ` · ${selectedShot.id}`}
        </div>
        <div className="ad-card" style={{ position: 'absolute', left: 8, right: 8, bottom: 8, zIndex: 3, padding: '6px 8px', display: 'grid', gap: 4 }}>
          <div className="ad-row" style={{ gap: 6 }}>
            <button type="button" className="ad-btn" data-kind={playing ? 'primary' : undefined} onClick={() => setPlaying(value => !value)}>{playing ? '暂停' : '播放'}</button>
            <button type="button" className="ad-btn" onClick={() => setFrame(0)}>回到起点</button>
            <span className="ad-tiny" style={{ minWidth: 64 }}>帧 {frame} / {duration}</span>
            <span className="ad-spacer" />
            <button type="button" className="ad-btn" disabled={selected === undefined} onClick={() => addKeyframe()}>加关键帧</button>
            <button type="button" className="ad-btn" onClick={addCameraKeyframe}>加机位帧</button>
            <button type="button" className="ad-btn" disabled={(doc.cameraKeys ?? []).length === 0} onClick={clearCameraKeys}>清机位帧</button>
          </div>
          <input type="range" min="0" max={duration} value={frame} onChange={event => { setPlaying(false); setFrame(Number(event.target.value)) }} />
          <div className="ad-row" style={{ justifyContent: 'space-between' }}>
            <span className="ad-tiny ad-muted">{selected === undefined ? '选中对象后编辑轨道' : `${selected.name} · ${(selected.keyframes ?? []).length} 个关键帧`} · 机位 {(doc.cameraKeys ?? []).length} 帧</span>
            <label className="ad-tiny">总帧数
              <input type="number" min="24" max="900" value={duration} style={{ width: 58, marginLeft: 4 }}
                onChange={event => persist({ ...doc, duration: Math.max(24, Math.min(900, Number(event.target.value) || 150)) })} />
            </label>
          </div>
        </div>
      </div>

      <div className="ad-col" style={{ minHeight: 0, overflow: 'auto', paddingLeft: 4 }}>
        <h3 className="ad-h2" style={{ marginTop: 0 }}>机位与分镜</h3>
        <label className="ad-tiny" style={{ opacity: .7 }}>绑定分镜</label>
        <select value={doc.shotId} onChange={event => persist({ ...doc, shotId: event.target.value })} style={{ width: '100%', height: 30, borderRadius: 7, padding: '0 8px', background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}>
          <option value="">不绑定</option>
          {shots.map(shot => <option key={shot.id} value={shot.id}>{shot.episodeId} · {shot.id} · {shot.size}</option>)}
        </select>
        {selectedShot === undefined ? null : <p className="ad-tiny ad-muted" style={{ marginTop: 6 }}>{selectedShot.action}</p>}
        <div className="ad-grid2" style={{ marginTop: 8 }}>
          <label className="ad-tiny">FOV<input type="number" value={Math.round(doc.camera.fov)} onChange={event => persist({ ...doc, camera: { ...doc.camera, fov: Math.max(12, Math.min(90, Number(event.target.value) || 42)) } })} style={{ width: '100%' }} /></label>
        </div>
        <h3 className="ad-h2" style={{ marginTop: 12 }}>3D 场景</h3>
        <div className="ad-col" style={{ gap: 6 }}>
          <label className="ad-tiny">背景色
            <input type="color" value={doc.scene?.background ?? '#161922'} onChange={event => persist({ ...doc, scene: { ...(doc.scene ?? { background: '#161922', ground: true, lightIntensity: 2.3, lightColor: '#fff2dc' }), background: event.target.value } })} style={{ width: '100%', height: 28 }} />
          </label>
          <label className="ad-tiny">地面 <input type="checkbox" checked={doc.scene?.ground !== false} onChange={event => persist({ ...doc, scene: { ...(doc.scene ?? { background: '#161922', ground: true, lightIntensity: 2.3, lightColor: '#fff2dc' }), ground: event.target.checked } })} /></label>
          <label className="ad-tiny">主光强度
            <input type="range" min="0" max="6" step="0.1" value={doc.scene?.lightIntensity ?? 2.3} onChange={event => persist({ ...doc, scene: { ...(doc.scene ?? { background: '#161922', ground: true, lightIntensity: 2.3, lightColor: '#fff2dc' }), lightIntensity: Number(event.target.value) } })} style={{ width: '100%' }} />
          </label>
          <label className="ad-tiny">主光颜色
            <input type="color" value={doc.scene?.lightColor ?? '#fff2dc'} onChange={event => persist({ ...doc, scene: { ...(doc.scene ?? { background: '#161922', ground: true, lightIntensity: 2.3, lightColor: '#fff2dc' }), lightColor: event.target.value } })} style={{ width: '100%', height: 28 }} />
          </label>
        </div>
        <h3 className="ad-h2" style={{ marginTop: 12 }}>运镜</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <button type="button" className="ad-btn" onClick={() => applyCameraMove('fixed')}>固定</button>
          <button type="button" className="ad-btn" onClick={() => applyCameraMove('pushIn')}>前推</button>
          <button type="button" className="ad-btn" onClick={() => applyCameraMove('pullOut')}>后拉</button>
          <button type="button" className="ad-btn" onClick={() => applyCameraMove('panLeft')}>左摇</button>
          <button type="button" className="ad-btn" onClick={() => applyCameraMove('panRight')}>右摇</button>
          <button type="button" className="ad-btn" onClick={() => applyCameraMove('rise')}>上升</button>
          <button type="button" className="ad-btn" onClick={() => applyCameraMove('orbit')}>环绕</button>
        </div>
        <h3 className="ad-h2" style={{ marginTop: 12 }}>输出</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <button type="button" className="ad-btn" onClick={snapshot}>截图</button>
          <button type="button" className="ad-btn" onClick={() => record(false)}>录制 5s</button>
          <button type="button" className="ad-btn" onClick={() => record(true)}>录屏到画布</button>
          <button type="button" className="ad-btn" data-kind="primary" onClick={sendToCanvas}>发送到画布</button>
          <button type="button" className="ad-btn" onClick={() => setFullscreen(value => !value)}>{fullscreen ? '退出全屏' : '全屏'}</button>
          <button type="button" className="ad-btn" onClick={() => setShowHelp(true)}>快捷键</button>
        </div>
        <h3 className="ad-h2" style={{ marginTop: 12 }}>属性</h3>
        {selected === undefined ? <p className="ad-tiny ad-muted">在 3D 视窗或左侧对象列表选中一个对象。</p> : (
          <div className="ad-col" style={{ gap: 6 }}>
            <div className="ad-tiny ad-muted">{selected.kind} · {selected.refId || selected.id}</div>
            {selected.kind === 'character' ? (
              <div className="ad-tiny">姿势
                <select aria-label="姿势" value={selected.pose ?? 'stand'} onChange={event => updateSelected({ pose: event.target.value as PoseId })}
                  style={{ width: '100%', height: 28, marginTop: 2, background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'inherit', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: 6 }}>
                  <option value="stand">站立</option>
                  <option value="walk">行走</option>
                  <option value="run">奔跑</option>
                  <option value="sit">坐下</option>
                  <option value="kneel">跪姿</option>
                </select>
              </div>
            ) : null}
            {(['x', 'y', 'z'] as const).map(axis => (
              <label key={axis} className="ad-tiny">{axis.toUpperCase()}
                <input type="number" step="0.1" value={Number(selected[axis].toFixed(2))} onChange={event => updateSelected({ [axis]: Number(event.target.value) || 0 })} style={{ width: '100%' }} />
              </label>
            ))}
            <div className="ad-tiny ad-muted" style={{ marginTop: 4 }}>旋转 Y</div>
            <input type="range" min="-180" max="180" value={Math.round(selected.ry * 180 / Math.PI)} onChange={event => updateSelected({ ry: Number(event.target.value) * Math.PI / 180 })} />
            <button type="button" className="ad-btn" onClick={() => persist({ ...doc, objects: doc.objects.filter(object => object.id !== selected.id) })}>删除对象</button>
          </div>
        )}
      </div>
      {showHelp ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center' }} onClick={() => setShowHelp(false)}>
          <div className="ad-card" style={{ width: 440, maxWidth: 'calc(100% - 32px)', padding: 18 }} onClick={event => event.stopPropagation()}>
            <div className="ad-row" style={{ justifyContent: 'space-between' }}>
              <h3 className="ad-h2" style={{ margin: 0 }}>3D 导演台操作</h3>
              <button type="button" className="ad-btn" onClick={() => setShowHelp(false)}>关闭</button>
            </div>
            <div className="ad-col ad-tiny" style={{ marginTop: 10, gap: 7 }}>
              <div><b>视角</b>：左键旋转、滚轮缩放、右键平移</div>
              <div><b>选择</b>：点击对象或左侧对象列表；锁定的对象不会移动</div>
              <div><b>移动/旋转/缩放</b>：选中对象后用底部工具切换，拖拽轴</div>
              <div><b>机位</b>：机位预设或「当前视角建机位」；「加机位帧」记录当前机位</div>
              <div><b>时间轴</b>：拖动滑杆、播放/暂停、加关键帧、总帧数</div>
              <div><b>动作</b>：选中角色后点击动作或「更多动作」</div>
              <div><b>轨迹</b>：点「轨迹」后点击地面落点，再「应用轨迹」</div>
              <div><b>输出</b>：截图、录制 5s、发送到画布、录屏到画布</div>
              <div><b>撤销/重做</b>：左侧按钮；Esc 退出全屏</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
