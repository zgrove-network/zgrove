import { useEffect, useState } from "react";
function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/** Settles a figure left to right out of noise, the way a terminal fills in a
 * value it was waiting on. A fade says "web page"; this says "readout". */
export function useSettle(target, span = 620) {
    const [shown, setShown] = useState("");
    useEffect(() => {
        if (target === null) {
            setShown("");
            return;
        }
        if (reducedMotion()) {
            setShown(target);
            return;
        }
        const began = Date.now();
        const id = window.setInterval(() => {
            const through = (Date.now() - began) / span;
            if (through >= 1) {
                setShown(target);
                window.clearInterval(id);
                return;
            }
            const settled = Math.floor(target.length * through);
            let out = "";
            for (let i = 0; i < target.length; i += 1) {
                const ch = target.charAt(i);
                out += i < settled || ch === "." ? ch : String(Math.floor(Math.random() * 10));
            }
            setShown(out);
        }, 45);
        return () => window.clearInterval(id);
    }, [target, span]);
    return shown;
}
