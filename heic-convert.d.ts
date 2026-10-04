declare module "heic-convert" {
  function convert(options: {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }): Promise<Uint8Array>;

  export default convert;
}
