import React, { useState, useEffect } from 'react';

export type ConfigForm = {
  object_id: number;
  object_label: string;
  device_id: number;
  sensor_input_label: string;
  sensor_source?: string;
  sensor_label: string;
  sensor_label_custom: string;
  min_threshold: string;
  max_threshold: string;
  multiplier: string;
};

export function ConfigModal({
  initial,
  isEdit,
  onSave,
  onCancel,
}: {
  initial: ConfigForm;
  isEdit?: boolean;
  onSave: (v: ConfigForm) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const min = form.min_threshold.trim() ? parseFloat(form.min_threshold) : null;
    const max = form.max_threshold.trim() ? parseFloat(form.max_threshold) : null;
    if (min != null && max != null && min >= max) {
      alert('MIN must be less than MAX');
      return;
    }
    if (!form.sensor_label_custom.trim()) {
      alert('Sensor label is required');
      return;
    }
    const mult = form.multiplier.trim() ? parseFloat(form.multiplier) : null;
    if (mult != null && (Number.isNaN(mult) || mult === 0)) {
      alert('Multiplier must be a non-zero number');
      return;
    }
    onSave({ ...form, min_threshold: form.min_threshold, max_threshold: form.max_threshold, multiplier: form.multiplier });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Configure sensor</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Object</label>
            <input type="text" value={form.object_label} readOnly />
          </div>
          <div className="form-row">
            <label>Sensor name</label>
            <input type="text" value={form.sensor_label} readOnly />
          </div>
          <div className="form-row">
            <label>Sensor label (display)</label>
            <input
              type="text"
              value={form.sensor_label_custom}
              onChange={(e) => setForm((f) => ({ ...f, sensor_label_custom: e.target.value }))}
              placeholder="Display name"
              required
            />
          </div>
          <div className="form-row">
            <label>MIN threshold (optional)</label>
            <input
              type="number"
              step="any"
              value={form.min_threshold}
              onChange={(e) => setForm((f) => ({ ...f, min_threshold: e.target.value }))}
              placeholder="Min"
            />
          </div>
          <div className="form-row">
            <label>MAX threshold (optional)</label>
            <input
              type="number"
              step="any"
              value={form.max_threshold}
              onChange={(e) => setForm((f) => ({ ...f, max_threshold: e.target.value }))}
              placeholder="Max"
            />
          </div>
          <div className="form-row">
            <label>Multiplier (optional)</label>
            <input
              type="number"
              step="any"
              value={form.multiplier}
              onChange={(e) => setForm((f) => ({ ...f, multiplier: e.target.value }))}
              placeholder="1"
              title="Scale raw values (e.g. 0.001 for millivolts to volts)"
            />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="submit">{isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
