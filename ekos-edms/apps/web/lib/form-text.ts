/**
 * FormData alanını metin olarak okur. Dosya girdileri (File) ve eksik alanlar boş metne indirgenir;
 * böylece "[object Object]" gibi varsayılan dönüşümler oluşmaz.
 */
export function formText(v: FormDataEntryValue | null | undefined): string {
  return typeof v === "string" ? v : "";
}
