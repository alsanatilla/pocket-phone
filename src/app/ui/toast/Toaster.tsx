import { useToast } from "./toast.ts";
import styles from "./Toaster.module.css";

export function Toaster() {
  const toast = useToast();
  return (
    <div className={styles.toaster} role="status" aria-live="polite">
      {toast ? <p key={toast.id} className={toast.tone === "error" ? styles.error : styles.info}>{toast.text}</p> : null}
    </div>
  );
}
