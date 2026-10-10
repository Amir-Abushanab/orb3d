package io.github.amirabushanab.orb3d.sample

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.SeekBar
import io.github.amirabushanab.orb3d.OrbPreset
import io.github.amirabushanab.orb3d.OrbProgram
import io.github.amirabushanab.orb3d.OrbSnapshot
import io.github.amirabushanab.orb3d.OrbView
import java.io.File
import kotlin.concurrent.thread

/**
 * The orb with a button per preset and per state, and a level slider. Launched with
 * `--es render all`, it instead writes every preset in every state to files/parity/ and exits,
 * for `pnpm parity --images`; programs pushed to files/programs/ (`<name>.program.json`, with
 * `picture.jpg` for one holding a picture) are drawn too.
 */
class MainActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (intent.getStringExtra("render") != null) return renderAll()

    val density = resources.displayMetrics.density
    val orb = OrbView(this)
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(0xFFEFEDEB.toInt())
      addView(orb, LinearLayout.LayoutParams((280 * density).toInt(), (280 * density).toInt()))
    }
    fun row(names: List<String>, pick: (String) -> Unit) = HorizontalScrollView(this).apply {
      addView(LinearLayout(this@MainActivity).apply {
        for (name in names) {
          addView(Button(this@MainActivity).apply {
            text = name
            isAllCaps = false
            setOnClickListener { pick(name) }
          })
        }
      })
    }
    layout.addView(row(OrbPreset.entries.map { it.name.lowercase() }) {
      orb.program = OrbPreset.valueOf(it.uppercase()).program
    })
    // Programs pushed to files/programs (see renderAll) get a button each too.
    val pushed = File(filesDir, "programs").listFiles { file -> file.name.endsWith(".program.json") }
    if (!pushed.isNullOrEmpty()) {
      val programs = pushed.associate { it.name.removeSuffix(".program.json") to it }
      layout.addView(row(programs.keys.sorted()) { name ->
        orb.image = File(filesDir, "programs/picture.jpg").takeIf { it.exists() }?.let {
          BitmapFactory.decodeFile(it.path)
        }
        orb.program = OrbProgram.fromJson(programs.getValue(name).readText())
      })
    }
    layout.addView(row(listOf("idle", "listening", "thinking", "speaking", "muted")) { orb.state = it })
    layout.addView(SeekBar(this).apply {
      max = 100
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
          orb.level = value / 100f
        }
        override fun onStartTrackingTouch(bar: SeekBar) {}
        override fun onStopTrackingTouch(bar: SeekBar) {}
      })
    }, LinearLayout.LayoutParams((280 * density).toInt(), LinearLayout.LayoutParams.WRAP_CONTENT))
    setContentView(layout)
  }

  private fun renderAll() {
    val time = intent.getFloatExtra("time", 3f)
    val size = intent.getIntExtra("size", 256)
    val out = File(filesDir, "parity").apply { deleteRecursively(); mkdirs() }
    val programs = File(filesDir, "programs")
    val picture: Bitmap? = File(programs, "picture.jpg").takeIf { it.exists() }?.let {
      BitmapFactory.decodeFile(it.path)
    }
    thread {
      val cases = OrbPreset.entries.map { it.name.lowercase() to it.program } +
        (programs.listFiles { file -> file.name.endsWith(".program.json") } ?: emptyArray()).map {
          it.name.removeSuffix(".program.json") to OrbProgram.fromJson(it.readText())
        }
      for ((name, program) in cases) {
        for (state in program.stateNames) {
          val bitmap = OrbSnapshot.bitmap(program, state, time, 0f, size, picture)
          File(out, "$name-$state.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
          }
        }
      }
      File(out, "done").writeText("ok")
      runOnUiThread { finish() }
    }
  }
}
