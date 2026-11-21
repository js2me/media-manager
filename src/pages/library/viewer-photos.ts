// Keep the image elements themselves so navigation can reuse an in-flight request.
export class ViewerPhotos {
  private images = new Map<string, HTMLImageElement>();

  get(url: string, foreground = false) {
    let image = this.images.get(url);
    if (foreground && image?.complete && !image.naturalWidth)
      image = undefined; // Retry a failed background request when opened.
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.fetchPriority = foreground ? "high" : "low";
      image.src = url;
      this.images.set(url, image);
    } else if (foreground) {
      image.fetchPriority = "high";
    }
    return image;
  }

  retain(urls: string[]) {
    for (const [url, image] of this.images) {
      if (!urls.includes(url)) {
        image.removeAttribute("src");
        this.images.delete(url);
      }
    }
  }
}
