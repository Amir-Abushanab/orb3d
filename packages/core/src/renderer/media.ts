// A picture or a clip for the orb to hold: loaded from its URL, uploaded to a WebGL texture with
// mipmaps (an orb shows a large picture small, and the glass crowds it at the rim), and for a clip
// re-uploaded whenever a new frame has been shown.

export type MediaKind = "image" | "video";

export class OrbMedia {
  readonly kind: MediaKind;
  readonly src: string;
  /** In pixels, once loaded; 0 until then, and after a failure. */
  width = 0;
  height = 0;
  #element: HTMLImageElement | HTMLVideoElement | null = null;
  #texture: WebGLTexture | null = null;
  #uploaded = -1;
  #allocatedWidth = 0;
  #allocatedHeight = 0;
  #videoFrame = 0;
  #frameCallback: number | undefined;
  #decodedFrames = false;
  #disposed = false;
  #settled = false;
  readonly #onChange: () => void;

  constructor(kind: MediaKind, src: string, onChange: () => void) {
    this.kind = kind;
    this.src = src;
    this.#onChange = onChange;
    if (src) this.#load();
  }

  #load(): void {
    if (this.kind === "image") {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.src = this.src;
      this.#element = image;
      image
        .decode()
        .then(() => this.#ready(image.naturalWidth, image.naturalHeight))
        .catch(() => this.#failed());
      return;
    }
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    // Muted and inline, the only way a clip may play on its own.
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = this.src;
    this.#element = video;
    this.#decodedFrames = typeof video.requestVideoFrameCallback === "function";
    if (this.#decodedFrames) this.#watchFrame();
    video.addEventListener("resize", () => {
      if (video.readyState >= 2) this.#ready(video.videoWidth, video.videoHeight);
    });
    video.addEventListener("loadeddata", () => this.#ready(video.videoWidth, video.videoHeight), {
      once: true,
    });
    video.addEventListener("error", () => this.#failed(), { once: true });
    video.load();
  }

  #watchFrame(): void {
    const video = this.#element;
    if (this.#disposed || !(video instanceof HTMLVideoElement)) return;
    this.#frameCallback = video.requestVideoFrameCallback(this.#onFrame);
  }

  #onFrame = (): void => {
    if (this.#disposed) return;
    this.#frameCallback = undefined;
    this.#videoFrame++;
    this.#watchFrame();
    // A seek while paused still needs a redraw; the renderer keeps its existing rAF when live.
    this.#onChange();
  };

  #ready(width: number, height: number): void {
    if (this.#disposed) return;
    this.#settled = true;
    this.width = width;
    this.height = height;
    this.#uploaded = -1;
    this.#onChange();
  }

  #failed(): void {
    if (this.#disposed) return;
    this.#settled = true;
    console.warn(`[orb3d] could not load ${this.kind} ${this.src}`);
    this.width = 0;
    this.height = 0;
    this.#onChange();
  }

  get ready(): boolean {
    return this.width > 0 && this.height > 0;
  }

  /** Still on its way: neither loaded nor failed. */
  get loading(): boolean {
    return this.src !== "" && !this.#settled;
  }

  /** Play a clip (muted, looping) or hold it on its frame. A picture ignores this. */
  setPlaying(playing: boolean): void {
    const video = this.#element;
    if (!(video instanceof HTMLVideoElement)) return;
    if (playing && video.paused) void video.play().catch(() => {});
    else if (!playing && !video.paused) video.pause();
  }

  /** Bind to texture unit 0, uploading first if there is something new to show. */
  bind(gl: WebGL2RenderingContext): void {
    gl.activeTexture(gl.TEXTURE0);
    if (!this.#texture) {
      this.#texture = gl.createTexture();
      this.#uploaded = -1;
      this.#allocatedWidth = this.#allocatedHeight = 0;
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    if (!this.ready || !this.#element) return;
    const frame =
      this.#element instanceof HTMLVideoElement
        ? this.#element.readyState >= 2
          ? this.#decodedFrames
            ? this.#videoFrame
            : this.#element.currentTime
          : -1
        : 0;
    if (frame < 0 || frame === this.#uploaded) return;
    this.#uploaded = frame;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (this.#allocatedWidth !== this.width || this.#allocatedHeight !== this.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.#element);
      this.#allocatedWidth = this.width;
      this.#allocatedHeight = this.height;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.#element);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** The context was lost with the texture in it: upload again into a new one. */
  lose(): void {
    this.#texture = null;
    this.#uploaded = -1;
  }

  dispose(gl: WebGL2RenderingContext | null): void {
    this.#disposed = true;
    if (gl && this.#texture) gl.deleteTexture(this.#texture);
    this.#texture = null;
    const element = this.#element;
    if (element instanceof HTMLVideoElement) {
      if (this.#frameCallback !== undefined) element.cancelVideoFrameCallback(this.#frameCallback);
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.#element = null;
  }
}
