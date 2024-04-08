/* eslint-disable @typescript-eslint/no-namespace */
export namespace FileUtils {
  /*
  * Converts Blob to base64
  * */
 export function blobToBase64(blob): Promise<ArrayBuffer | string> {
    return new Promise((resolve, _) => {
      const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

    /*
     * Add base64 notation in front of base64 image
     * */
    export function getEncodedBase64String(base64: string): string {
        return `data:image/jpeg;base64,${base64}`;
    }
}
