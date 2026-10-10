package io.github.amirabushanab.orb3d

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.net.Uri
import android.opengl.EGL14
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES30
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.AttributeSet
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import android.view.TextureView
import java.net.URL
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min

/**
 * A glass orb with states, as a View.
 *
 *     val orb = OrbView(context) // clear glass; or set program = OrbPreset.AURA.program
 *     orb.state = "thinking" // springs there
 *     orb.level = 0.6f       // 0 to 1, drives the states that react to it
 *
 * For image or video contents, [image] or [video] is the picture or clip to hold instead of the
 * one the program names (a URL, or a file in the app's assets).
 *
 * A TextureView rendering GLES 3.0 on its own thread, so it composites like any other view:
 * transparent around the orb, under views drawn over it, inside animations. It draws only while
 * attached and visible, and under "Remove animations" (animator duration scale 0) it holds a
 * still frame and cuts between states.
 *
 * In Compose: `AndroidView(factory = { OrbView(it) }, update = { it.state = state })`.
 */
class OrbView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : TextureView(context, attrs), TextureView.SurfaceTextureListener {

  /** What the orb looks like. Changing it cuts the dials to the new program's values. */
  var program: OrbProgram = OrbPreset.CLEAR.program
    set(value) {
      field = value
      thread?.setProgram(value, state)
    }

  /** The state to show. Changing it springs the orb there. */
  var state: String = program.state
    set(value) {
      field = value
      post { setState(value, immediate = !animating) }
    }

  /** The input level, 0 to 1: a voice's loudness, a progress pulse. */
  var level: Float = 0f
    set(value) {
      field = value
      post { setLevel(value) }
    }

  /** Hold still (or carry on). */
  var paused: Boolean = false
    set(value) {
      field = value
      thread?.refresh()
    }

  /** The picture for image contents, instead of the one the program names. */
  var image: Bitmap? = null
    set(value) {
      field = value
      thread?.loadMedia()
    }

  /** The clip for video contents, instead of the one the program names. */
  var video: Uri? = null
    set(value) {
      field = value
      thread?.loadMedia()
    }

  private var thread: RenderThread? = null
  private var visible = true

  init {
    isOpaque = false
    surfaceTextureListener = this
  }

  private val animating: Boolean
    get() = !paused && animatorsEnabled()

  private fun animatorsEnabled(): Boolean =
    if (Build.VERSION.SDK_INT >= 26) ValueAnimator.areAnimatorsEnabled() else true

  /** Run [block] against the runtime on the render thread, before its next frame. */
  private fun post(block: OrbRuntime.() -> Unit) {
    thread?.run(block)
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    thread = RenderThread(surface, width, height, program, state, level).also { it.start() }
  }

  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
    thread?.resize(width, height)
  }

  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
    thread?.shutdown()
    thread = null
    return true
  }

  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}

  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    visible = isVisible
    thread?.refresh()
  }

  /** A picture a program names: a web URL, a file or content URI, or a file in the app's assets. */
  private fun readBitmap(source: String): Bitmap? = runCatching {
    when {
      source.startsWith("http://") || source.startsWith("https://") ->
        URL(source).openStream().use(BitmapFactory::decodeStream)
      source.contains("://") ->
        context.contentResolver.openInputStream(Uri.parse(source))?.use(BitmapFactory::decodeStream)
      else -> context.assets.open(source).use(BitmapFactory::decodeStream)
    }
  }.onFailure { Log.w("orb3d", "could not load the picture $source", it) }.getOrNull()

  /** GLES on one thread, paced by that thread's Choreographer. */
  private inner class RenderThread(
    private val texture: SurfaceTexture,
    private var width: Int,
    private var height: Int,
    program: OrbProgram,
    state: String,
    level: Float,
  ) : HandlerThread("orb3d"), Choreographer.FrameCallback {
    private val runtime = OrbRuntime(program, state).apply { setLevel(level) }
    private lateinit var handler: Handler
    private val startupLock = Any()
    private val pending = ArrayDeque<OrbRuntime.() -> Unit>()
    @Volatile private var stopping = false
    private var egl: OrbEgl? = null
    private var surface: EGLSurface? = null
    private var gl: OrbGlProgram? = null
    private var glKey: String? = null
    private var last = 0L
    private var ticking = false

    // The picture or clip: what it is, and its texture.
    private var mediaKey: String? = null
    private var picture: OrbImageTexture? = null
    private var clipTexture = 0
    private var clipSurface: SurfaceTexture? = null
    private var player: MediaPlayer? = null
    private var newFrame = false
    private val clipMatrix = FloatArray(16)
    private var ticket = 0

    override fun onLooperPrepared() {
      synchronized(startupLock) {
        if (stopping) { quitSafely(); return }
        handler = Handler(looper)
        while (pending.isNotEmpty()) {
          val block = pending.removeFirst()
          handler.post { if (!stopping) { runtime.block(); update() } }
        }
      }
      val egl = OrbEgl(pbuffer = false)
      val surface = EGL14.eglCreateWindowSurface(egl.display, egl.config, texture, intArrayOf(EGL14.EGL_NONE), 0)
      EGL14.eglMakeCurrent(egl.display, surface, surface, egl.context)
      this.egl = egl
      this.surface = surface
      build()
      loadMedia()
      update()
    }

    fun run(block: OrbRuntime.() -> Unit) {
      synchronized(startupLock) {
        if (stopping) return
        if (!::handler.isInitialized) pending.addLast(block)
        else handler.post {
          if (stopping) return@post
          runtime.block()
          update()
        }
      }
    }

    fun setProgram(program: OrbProgram, state: String) = run {
      setProgram(program, state)
      build()
      loadMedia()
    }

    fun resize(width: Int, height: Int) = run {
      this@RenderThread.width = width
      this@RenderThread.height = height
    }

    fun refresh() = run {}

    /** Compile the program's shader, unless it is the one already built. */
    private fun build() {
      val program = runtime.program
      val clip = program.mediaKind == "video"
      val key = "$clip:${program.fragmentShader.hashCode()}:${program.contents}"
      if (key == glKey) return
      gl?.release()
      gl = OrbGlProgram(program.fragmentShader, external = clip, paint = program.paint)
      glKey = key
    }

    /** Load the picture or clip the contents hold, if that changed; drop one no longer held. */
    fun loadMedia() {
      if (stopping || !::handler.isInitialized) return
      handler.post {
        if (stopping) return@post
        val program = runtime.program
        val kind = program.mediaKind
        val key = when (kind) {
          "image" -> "image:${image?.let { System.identityHashCode(it) } ?: program.mediaSource}"
          "video" -> "video:${video ?: program.mediaSource}"
          else -> null
        }
        if (key == mediaKey) return@post
        mediaKey = key
        dropMedia()
        val mine = ++ticket
        when (kind) {
          "image" -> {
            val given = image
            val source = program.mediaSource
            thread {
              val bitmap = given ?: source?.let(::readBitmap) ?: return@thread
              handler.post {
                if (stopping || mine != ticket) return@post
                picture = OrbImageTexture(bitmap).also { runtime.setMedia(it.width, it.height) }
                update()
              }
            }
          }
          "video" -> playClip(video ?: program.mediaSource?.let(::clipUri))
        }
      }
    }

    private fun clipUri(source: String): Uri? =
      if (source.contains("://")) Uri.parse(source) else null

    /** A clip into an external texture through a SurfaceTexture, muted and looping. */
    private fun playClip(uri: Uri?) {
      val ids = IntArray(1)
      GLES30.glGenTextures(1, ids, 0)
      clipTexture = ids[0]
      GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, clipTexture)
      GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
      GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
      val frames = SurfaceTexture(clipTexture)
      frames.setOnFrameAvailableListener({ newFrame = true }, handler)
      clipSurface = frames
      val player = MediaPlayer()
      this.player = player
      runCatching {
        val source = runtime.program.mediaSource
        when {
          uri != null -> player.setDataSource(context, uri)
          source != null -> context.assets.openFd(source).use {
            player.setDataSource(it.fileDescriptor, it.startOffset, it.length)
          }
          else -> return
        }
        player.setSurface(Surface(frames))
        player.isLooping = true
        player.setVolume(0f, 0f)
        player.setOnVideoSizeChangedListener { _, w, h ->
          handler.post {
            if (stopping || this.player !== player) return@post
            runtime.setMedia(w, h)
            update()
          }
        }
        player.setOnPreparedListener {
          if (!stopping && this.player === it && animating && visible) it.start()
        }
        player.prepareAsync()
      }.onFailure { Log.w("orb3d", "could not play the clip", it) }
    }

    private fun dropMedia() {
      ticket++
      picture?.release()
      picture = null
      player?.release()
      player = null
      clipSurface?.release()
      clipSurface = null
      if (clipTexture != 0) GLES30.glDeleteTextures(1, intArrayOf(clipTexture), 0)
      clipTexture = 0
      runtime.setMedia(0, 0)
    }

    fun shutdown() {
      synchronized(startupLock) {
        stopping = true
        pending.clear()
        if (::handler.isInitialized) {
          handler.post {
            Choreographer.getInstance().removeFrameCallback(this)
            dropMedia()
            gl?.release()
            egl?.release(surface)
            egl = null
            quitSafely()
          }
        } else {
          quitSafely()
        }
      }
    }

    /** Tick while animating; otherwise draw the one frame that shows the latest change. */
    private fun update() {
      if (stopping) return
      val animate = animating && visible
      if (!animatorsEnabled()) runtime.settle()
      player?.let { if (animate && !it.isPlaying) runCatching { it.start() } else if (!animate && it.isPlaying) it.pause() }
      if (animate && !ticking) {
        ticking = true
        last = System.nanoTime()
        Choreographer.getInstance().postFrameCallback(this)
      } else if (!animate) {
        ticking = false
        Choreographer.getInstance().removeFrameCallback(this)
        draw()
      }
    }

    override fun doFrame(frameTimeNanos: Long) {
      if (stopping || !ticking) return
      val dt = min(max((frameTimeNanos - last) / 1e9f, 0f), 0.1f)
      last = frameTimeNanos
      runtime.advance(dt)
      draw()
      Choreographer.getInstance().postFrameCallback(this)
    }

    private fun draw() {
      val egl = egl ?: return
      val frames = clipSurface
      if (frames != null && newFrame) {
        newFrame = false
        frames.updateTexImage()
        frames.getTransformMatrix(clipMatrix)
      }
      val bound = if (frames != null) clipTexture else picture?.id ?: 0
      gl?.draw(runtime, width, height, bound, if (frames != null) clipMatrix else null)
      EGL14.eglSwapBuffers(egl.display, surface)
    }
  }
}
