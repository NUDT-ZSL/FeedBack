import { useState } from 'react';
import toast from 'react-hot-toast';

interface BorrowFormProps {
  onSubmit: (data: { name: string; phone: string; returnDate: string }) => void;
}

function getDefaultReturnDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

interface FormErrors {
  name?: string;
  phone?: string;
  returnDate?: string;
}

export default function BorrowForm({ onSubmit }: BorrowFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [returnDate, setReturnDate] = useState(getDefaultReturnDate);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!name.trim()) {
      errs.name = '请输入借阅人姓名';
    } else if (!/^[\u4e00-\u9fa5a-zA-Z\s]+$/.test(name.trim())) {
      errs.name = '姓名仅支持中文或英文';
    }
    if (!phone.trim()) {
      errs.phone = '请输入手机号';
    } else if (!/^1\d{10}$/.test(phone.trim())) {
      errs.phone = '请输入11位手机号';
    }
    if (!returnDate) {
      errs.returnDate = '请选择归还日期';
    } else if (new Date(returnDate) <= new Date()) {
      errs.returnDate = '归还日期须在今日之后';
    }
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error(Object.values(errs)[0], { duration: 2500 });
      return;
    }
    setSubmitting(true);
    setTimeout(() => {
      onSubmit({ name: name.trim(), phone: phone.trim(), returnDate });
      setSubmitting(false);
    }, 100);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-group">
        <label htmlFor="borrow-name">借阅人姓名</label>
        <input
          id="borrow-name"
          type="text"
          placeholder="请输入中文或英文姓名"
          value={name}
          onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }}
          className={errors.name ? 'error' : ''}
        />
        {errors.name && <span style={{ color: 'var(--error)', fontSize: '0.78rem' }}>{errors.name}</span>}
      </div>
      <div className="form-group">
        <label htmlFor="borrow-phone">手机号</label>
        <input
          id="borrow-phone"
          type="tel"
          placeholder="请输入11位手机号"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setErrors((p) => ({ ...p, phone: undefined })); }}
          className={errors.phone ? 'error' : ''}
          maxLength={11}
        />
        {errors.phone && <span style={{ color: 'var(--error)', fontSize: '0.78rem' }}>{errors.phone}</span>}
      </div>
      <div className="form-group">
        <label htmlFor="borrow-date">预计归还日期</label>
        <input
          id="borrow-date"
          type="date"
          value={returnDate}
          onChange={(e) => { setReturnDate(e.target.value); setErrors((p) => ({ ...p, returnDate: undefined })); }}
          className={errors.returnDate ? 'error' : ''}
          min={new Date().toISOString().split('T')[0]}
        />
        {errors.returnDate && <span style={{ color: 'var(--error)', fontSize: '0.78rem' }}>{errors.returnDate}</span>}
      </div>
      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: '8px' }}
        disabled={submitting}
      >
        {submitting ? '提交中...' : '确认借阅'}
      </button>
    </form>
  );
}
