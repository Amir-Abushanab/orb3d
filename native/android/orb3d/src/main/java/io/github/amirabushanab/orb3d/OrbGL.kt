package io.github.amirabushanab.orb3d

import android.graphics.Bitmap
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES30
import android.opengl.GLUtils
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

/** An EGL display, config and GLES 3.0 context: what both the view and snapshots render with. */
internal class OrbEgl(pbuffer: Boolean) {
  val display: EGLDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
  val config: EGLConfig
  val context: EGLContext

  init {
    val version = IntArray(2)
    check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }
    val attributes = intArrayOf(
      EGL14.EGL_RED_SIZE, 8,
      EGL14.EGL_GREEN_SIZE, 8,
      EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR,
      EGL14.EGL_SURFACE_TYPE, if (pbuffer) EGL14.EGL_PBUFFER_BIT else EGL14.EGL_WINDOW_BIT,
      EGL14.EGL_NONE,
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val count = IntArray(1)
    check(EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) && count[0] > 0) {
      "no RGBA8 GLES 3.0 config"
    }
    config = configs[0]!!
    context = EGL14.eglCreateContext(
      display, config, EGL14.EGL_NO_CONTEXT,
      intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0,
    )
    check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
  }

  fun release(surface: EGLSurface?) {
    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
    if (surface != null) EGL14.eglDestroySurface(display, surface)
    EGL14.eglDestroyContext(display, context)
    EGL14.eglTerminate(display)
  }
}

/**
 * The orb's GLES program for one program's shader: one full-screen triangle and the fragment
 * shader for its contents. [external] reads a clip from a SurfaceTexture's external texture
 * instead of a picture's 2D one.
 */
internal class OrbGlProgram(source: String, private val external: Boolean = false, private val paint: OrbProgram.Paint? = null) {
  private val program: Int
  private val paints: IntArray
  private val paintUploads: List<java.nio.FloatBuffer>
  private val data: Int
  private val upload: java.nio.FloatBuffer
  private val extra: Int
  private val extraUpload: java.nio.FloatBuffer?
  private val mediaMatrix: Int

  init {
    fun compile(type: Int, text: String): Int {
      val shader = GLES30.glCreateShader(type)
      GLES30.glShaderSource(shader, text)
      GLES30.glCompileShader(shader)
      val status = IntArray(1)
      GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
      check(status[0] != 0) { "orb3d shader failed to compile: ${GLES30.glGetShaderInfoLog(shader)}" }
      return shader
    }
    val vertex = compile(GLES30.GL_VERTEX_SHADER, ORB_VERTEX_SHADER)
    val fragment = compile(GLES30.GL_FRAGMENT_SHADER, if (external) forClips(source) else source)
    program = GLES30.glCreateProgram()
    GLES30.glAttachShader(program, vertex)
    GLES30.glAttachShader(program, fragment)
    GLES30.glLinkProgram(program)
    val status = IntArray(1)
    GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, status, 0)
    check(status[0] != 0) { "orb3d shader failed to link: ${GLES30.glGetProgramInfoLog(program)}" }
    GLES30.glDeleteShader(vertex)
    GLES30.glDeleteShader(fragment)
    val block = GLES30.glGetUniformBlockIndex(program, "OrbData")
    val bytes = IntArray(1)
    GLES30.glGetActiveUniformBlockiv(program, block, GLES30.GL_UNIFORM_BLOCK_DATA_SIZE, bytes, 0)
    val buffers = IntArray(1)
    GLES30.glGenBuffers(1, buffers, 0)
    data = buffers[0]
    GLES30.glUniformBlockBinding(program, block, 0)
    GLES30.glBindBuffer(GLES30.GL_UNIFORM_BUFFER, data)
    GLES30.glBufferData(GLES30.GL_UNIFORM_BUFFER, bytes[0], null, GLES30.GL_DYNAMIC_DRAW)
    upload = ByteBuffer.allocateDirect(bytes[0]).order(ByteOrder.nativeOrder()).asFloatBuffer()
    val extraBlock = GLES30.glGetUniformBlockIndex(program,"OrbDataExtra")
    if (extraBlock != GLES30.GL_INVALID_INDEX) {
      GLES30.glGetActiveUniformBlockiv(program,extraBlock,GLES30.GL_UNIFORM_BLOCK_DATA_SIZE,bytes,0)
      GLES30.glGenBuffers(1,buffers,0); extra = buffers[0]
      GLES30.glUniformBlockBinding(program,extraBlock,12)
      GLES30.glBindBuffer(GLES30.GL_UNIFORM_BUFFER,extra)
      GLES30.glBufferData(GLES30.GL_UNIFORM_BUFFER,bytes[0],null,GLES30.GL_DYNAMIC_DRAW)
      extraUpload = ByteBuffer.allocateDirect(bytes[0]).order(ByteOrder.nativeOrder()).asFloatBuffer()
    } else { extra = 0; extraUpload = null }
    mediaMatrix = GLES30.glGetUniformLocation(program, "uMediaMatrix")
    GLES30.glUseProgram(program)
    GLES30.glGetUniformLocation(program, "uMedia").let { if (it >= 0) GLES30.glUniform1i(it, 0) }
    paintUploads = (paint?.pages ?: IntArray(0)).map { slots ->
      ByteBuffer.allocateDirect(slots * 16).order(ByteOrder.nativeOrder()).asFloatBuffer()
    }
    paints = IntArray(paintUploads.size)
    if (paints.isNotEmpty()) GLES30.glGenBuffers(paints.size, paints, 0)
    for (i in paints.indices) {
      val block = GLES30.glGetUniformBlockIndex(program, "OrbPaint$i")
      if (block != GLES30.GL_INVALID_INDEX) GLES30.glUniformBlockBinding(program, block, i + 1)
      GLES30.glBindBuffer(GLES30.GL_UNIFORM_BUFFER, paints[i])
      GLES30.glBufferData(GLES30.GL_UNIFORM_BUFFER, paint!!.pages[i] * 16, null, GLES30.GL_DYNAMIC_DRAW)
    }
    // GLES 3.0 draws from gl_VertexID with no attributes, but wants a vertex array bound.
    val vao = IntArray(1)
    GLES30.glGenVertexArrays(1, vao, 0)
    GLES30.glBindVertexArray(vao[0])
  }

  /** Draw a frame, with [texture] (a picture, or a clip's frame) in texture unit 0 if given. */
  fun draw(
    runtime: OrbRuntime,
    width: Int,
    height: Int,
    texture: Int = 0,
    matrix: FloatArray? = null,
  ) {
    GLES30.glViewport(0, 0, width, height)
    GLES30.glClearColor(0f, 0f, 0f, 0f)
    GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
    GLES30.glUseProgram(program)
    if (texture != 0) {
      GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
      GLES30.glBindTexture(if (external) GLES11Ext.GL_TEXTURE_EXTERNAL_OES else GLES30.GL_TEXTURE_2D, texture)
    }
    if (mediaMatrix >= 0 && matrix != null) GLES30.glUniformMatrix4fv(mediaMatrix, 1, false, matrix, 0)
    val uniforms = runtime.write(width.toFloat(), height.toFloat())
    upload.clear()
    val mainLength = min(uniforms.size,4096)
    upload.put(uniforms,0,mainLength).flip()
    GLES30.glBindBuffer(GLES30.GL_UNIFORM_BUFFER, data)
    GLES30.glBindBufferBase(GLES30.GL_UNIFORM_BUFFER, 0, data)
    GLES30.glBufferSubData(GLES30.GL_UNIFORM_BUFFER, 0, mainLength * 4, upload)
    extraUpload?.let { bytes ->
      val length = uniforms.size-4096
      bytes.clear(); bytes.put(uniforms,4096,length).flip()
      GLES30.glBindBuffer(GLES30.GL_UNIFORM_BUFFER,extra)
      GLES30.glBindBufferBase(GLES30.GL_UNIFORM_BUFFER,12,extra)
      GLES30.glBufferSubData(GLES30.GL_UNIFORM_BUFFER,0,length*4,bytes)
    }
    var start = 0
    for (i in paints.indices) {
      val length = runtime.program.paint!!.pages[i] * 4
      val bytes = paintUploads[i]
      bytes.clear()
      bytes.put(runtime.paintData, start, length).position(0)
      GLES30.glBindBuffer(GLES30.GL_UNIFORM_BUFFER, paints[i])
      GLES30.glBindBufferBase(GLES30.GL_UNIFORM_BUFFER, i + 1, paints[i])
      GLES30.glBufferSubData(GLES30.GL_UNIFORM_BUFFER, 0, length * 4, bytes)
      start += length
    }
    GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3)
  }

  fun release() {
    GLES30.glDeleteBuffers(paints.size, paints, 0)
    if (extra != 0) GLES30.glDeleteBuffers(1,intArrayOf(extra),0)
    GLES30.glDeleteBuffers(1, intArrayOf(data), 0)
    GLES30.glDeleteProgram(program)
  }

  companion object {
    private const val PICTURE = """uniform sampler2D uMedia;
vec4 sampleMedia(vec2 uv, float lod) { return textureLod(uMedia, uv, lod); }"""

    /**
     * The shader reading a clip from a SurfaceTexture: an external texture, through the
     * transform the SurfaceTexture hands each frame (whose texture coordinates start at the
     * bottom), with no mipmaps.
     */
    private fun forClips(source: String): String {
      check(PICTURE in source) { "orb3d shader has no picture to read a clip into" }
      return source
        .replaceFirst("#version 300 es\n", "#version 300 es\n#extension GL_OES_EGL_image_external_essl3 : require\n")
        .replace(
          PICTURE,
          "uniform samplerExternalOES uMedia;\nuniform mat4 uMediaMatrix;\n" +
            "vec4 sampleMedia(vec2 uv, float lod) { " +
            "return texture(uMedia, (uMediaMatrix * vec4(uv.x, 1.0 - uv.y, 0.0, 1.0)).xy); }",
        )
    }
  }
}

/** A picture uploaded to a GLES texture with mipmaps, at most 2048 pixels on a side. */
internal class OrbImageTexture(bitmap: Bitmap) {
  val id: Int
  val width: Int
  val height: Int

  init {
    val scale = min(1f, 2048f / max(bitmap.width, bitmap.height))
    val sized = if (scale < 1f) {
      Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * scale).toInt()), max(1, (bitmap.height * scale).toInt()), true)
    } else {
      bitmap
    }
    width = sized.width
    height = sized.height
    val ids = IntArray(1)
    GLES30.glGenTextures(1, ids, 0)
    id = ids[0]
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, id)
    // A bitmap holds premultiplied colour, the top row first: as the shader reads it.
    GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, sized, 0)
    GLES30.glGenerateMipmap(GLES30.GL_TEXTURE_2D)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR_MIPMAP_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
    if (sized !== bitmap) sized.recycle()
  }

  fun release() {
    GLES30.glDeleteTextures(1, intArrayOf(id), 0)
  }
}

/** Still frames without a view: posters, previews, tests. */
object OrbSnapshot {
  /**
   * The orb in [state], [time] seconds after it opened there, settled, as a square bitmap with a
   * transparent background. `time = 0f` is the frame the live orb starts on; [image] is the
   * picture for image contents. Call it off the main thread: it makes its own GLES context.
   */
  @JvmStatic
  @JvmOverloads
  fun bitmap(
    program: OrbProgram,
    state: String = program.state,
    time: Float = 0f,
    level: Float = 0f,
    size: Int = 512,
    image: Bitmap? = null,
  ): Bitmap {
    val egl = OrbEgl(pbuffer = true)
    val surface = EGL14.eglCreatePbufferSurface(
      egl.display, egl.config,
      intArrayOf(EGL14.EGL_WIDTH, size, EGL14.EGL_HEIGHT, size, EGL14.EGL_NONE), 0,
    )
    try {
      check(EGL14.eglMakeCurrent(egl.display, surface, surface, egl.context)) { "eglMakeCurrent failed" }
      val runtime = OrbRuntime(program, state)
      runtime.setLevel(level)
      runtime.seek(time)
      val picture = if (image != null && program.mediaKind != null) OrbImageTexture(image) else null
      picture?.let { runtime.setMedia(it.width, it.height) }
      val gl = OrbGlProgram(program.fragmentShader, paint = program.paint)
      gl.draw(runtime, size, size, picture?.id ?: 0)
      gl.release()
      picture?.release()
      val pixels = ByteBuffer.allocateDirect(size * size * 4).order(ByteOrder.nativeOrder())
      GLES30.glReadPixels(0, 0, size, size, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, pixels)
      // GL reads bottom row first; a bitmap wants the top row first.
      val flipped = ByteBuffer.allocateDirect(size * size * 4)
      val row = ByteArray(size * 4)
      for (y in size - 1 downTo 0) {
        pixels.position(y * size * 4)
        pixels.get(row)
        flipped.put(row)
      }
      flipped.rewind()
      // The shader writes premultiplied colour, which is what an ARGB_8888 bitmap holds.
      return Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).apply {
        copyPixelsFromBuffer(flipped)
      }
    } finally {
      egl.release(surface)
    }
  }
}
