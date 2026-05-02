import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  parseIstLocalString,
  formatIstLocalString,
  istNowLocalString,
  datetimeLocalIstToIso,
} from "../utils/maintenanceIst.js";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function istMondayFirstOffset(year, month1to12) {
  const iso = datetimeLocalIstToIso(`${year}-${pad2(month1to12)}-01T12:00`);
  if (!iso) return 0;
  const d = new Date(iso);
  const w = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(d);
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[w] ?? 0;
}

function buildCalendar(year, month1to12) {
  const leading = istMondayFirstOffset(year, month1to12);
  const daysThis = new Date(year, month1to12, 0).getDate();
  const daysPrev = new Date(year, month1to12 - 1, 0).getDate();
  const py = month1to12 === 1 ? year - 1 : year;
  const pm = month1to12 === 1 ? 12 : month1to12 - 1;
  const ny = month1to12 === 12 ? year + 1 : year;
  const nm = month1to12 === 12 ? 1 : month1to12 + 1;
  const cells = [];
  for (let i = 0; i < leading; i++) {
    const d = daysPrev - leading + i + 1;
    cells.push({ y: py, m: pm, d, outside: true });
  }
  for (let d = 1; d <= daysThis; d++) {
    cells.push({ y: year, m: month1to12, d, outside: false });
  }
  let nextD = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ y: ny, m: nm, d: nextD++, outside: true });
  }
  return cells;
}

function TimeColumn({ values, selected, format, onSelect }) {
  return (
    <div className="maint-dt__col">
      <div className="maint-dt__col-scroll">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className={`maint-dt__time-btn${selected === v ? " maint-dt__time-btn--selected" : ""}`}
            onClick={() => onSelect(v)}
          >
            {format(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Black + gold themed picker — centered modal (portal) with Save / Cancel; IST wall time string in/out.
 */
export default function MaintenanceDatetimeField({ label, value, onChange, id }) {
  const [open, setOpen] = useState(false);
  const [draftStr, setDraftStr] = useState("");
  const parsedCommitted = parseIstLocalString(value);
  const fallback =
    parseIstLocalString(istNowLocalString()) || {
      y: 2026,
      mo: 1,
      d: 1,
      h: 0,
      mi: 0,
    };

  const workingParsed = parseIstLocalString(draftStr);
  const cur = workingParsed || fallback;
  const sel = workingParsed;

  const [viewY, setViewY] = useState(cur.y);
  const [viewM, setViewM] = useState(cur.mo);

  const openModal = () => {
    const seed = value;
    const p = parseIstLocalString(seed);
    const d = p || parseIstLocalString(istNowLocalString()) || fallback;
    setViewY(d.y);
    setViewM(d.mo);
    setDraftStr(seed);
    setOpen(true);
  };

  const closeModal = () => setOpen(false);

  const handleSave = () => {
    onChange(draftStr);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const cells = buildCalendar(viewY, viewM);

  const displayText =
    parsedCommitted != null
      ? `${pad2(parsedCommitted.d)} ${MONTHS[parsedCommitted.mo - 1]} ${parsedCommitted.y}, ${pad2(parsedCommitted.h)}:${pad2(parsedCommitted.mi)}`
      : "Select date & time";

  const selectDay = (cell) => {
    const base = parseIstLocalString(draftStr) || fallback;
    setDraftStr(
      formatIstLocalString({
        y: cell.y,
        mo: cell.m,
        d: cell.d,
        h: base.h,
        mi: base.mi,
      })
    );
  };

  const setTime = (h, mi) => {
    const base = parseIstLocalString(draftStr) || fallback;
    setDraftStr(formatIstLocalString({ y: base.y, mo: base.mo, d: base.d, h, mi }));
  };

  const goPrev = () => {
    if (viewM === 1) {
      setViewM(12);
      setViewY((y) => y - 1);
    } else setViewM((m) => m - 1);
  };
  const goNext = () => {
    if (viewM === 12) {
      setViewM(1);
      setViewY((y) => y + 1);
    } else setViewM((m) => m + 1);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const labelId = id ? `${id}-label` : undefined;

  const modal =
    open &&
    createPortal(
      <div className="maint-dt__overlay" role="presentation">
        <button
          type="button"
          className="maint-dt__backdrop"
          aria-label="Close"
          onClick={closeModal}
        />
        <div
          className="maint-dt__modal-shell"
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          aria-label={label ? undefined : "Choose date and time"}
        >
          <div className="maint-dt__popover maint-dt__popover--modal">
            <div className="maint-dt__picker">
              <div className="maint-dt__cal">
                <div className="maint-dt__cal-head">
                  <button type="button" className="maint-dt__nav" onClick={goPrev} aria-label="Previous month">
                    ‹
                  </button>
                  <span className="maint-dt__month">
                    {MONTHS[viewM - 1]} {viewY}
                  </span>
                  <button type="button" className="maint-dt__nav" onClick={goNext} aria-label="Next month">
                    ›
                  </button>
                </div>
                <div className="maint-dt__dow">
                  {DOW.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="maint-dt__grid">
                  {cells.map((cell, i) => {
                    const isSel = sel && sel.y === cell.y && sel.mo === cell.m && sel.d === cell.d;
                    return (
                      <button
                        key={`${cell.y}-${cell.m}-${cell.d}-o${cell.outside}-${i}`}
                        type="button"
                        className={`maint-dt__day${cell.outside ? " maint-dt__day--outside" : ""}${
                          isSel ? " maint-dt__day--selected" : ""
                        }`}
                        onClick={() => selectDay(cell)}
                      >
                        {cell.d}
                      </button>
                    );
                  })}
                </div>
                <div className="maint-dt__footer">
                  <button type="button" className="maint-dt__link" onClick={() => setDraftStr("")}>
                    Clear
                  </button>
                  <button
                    type="button"
                    className="maint-dt__link"
                    onClick={() => {
                      const n = istNowLocalString();
                      setDraftStr(n);
                      const p = parseIstLocalString(n);
                      if (p) {
                        setViewY(p.y);
                        setViewM(p.mo);
                      }
                    }}
                  >
                    Today
                  </button>
                </div>
              </div>
              <div className="maint-dt__divider" aria-hidden="true" />
              <div className="maint-dt__time">
                <span className="maint-dt__time-label">Time</span>
                <div className="maint-dt__rolls">
                  <TimeColumn
                    values={hours}
                    selected={cur.h}
                    format={(h) => pad2(h)}
                    onSelect={(h) => setTime(h, cur.mi)}
                  />
                  <TimeColumn
                    values={minutes}
                    selected={cur.mi}
                    format={(m) => pad2(m)}
                    onSelect={(m) => setTime(cur.h, m)}
                  />
                </div>
              </div>
            </div>
            <div className="maint-dt__modal-actions">
              <button type="button" className="btn btn--ghost maint-dt__btn" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn--gold maint-dt__btn maint-dt__btn--primary" onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );

  return (
    <div className="maint-dt">
      {label ? (
        <span className="maint-dt__label maintenance-field__label" id={labelId}>
          {label}
        </span>
      ) : null}
      <button
        type="button"
        className="maint-dt__display maintenance-field__input"
        aria-labelledby={labelId}
        aria-expanded={open}
        onClick={openModal}
      >
        {displayText}
      </button>
      {modal}
    </div>
  );
}
