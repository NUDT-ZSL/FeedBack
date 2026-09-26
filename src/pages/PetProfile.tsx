import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Home, Briefcase, X, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Pet, SPECIES_LABELS } from '../types';

function PetProfile() {
  const { state, fetchPets, addPet, updatePetStatus } = useApp();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    species: 'cat' as Pet['species'],
    breed: '',
    age: '',
    gender: 'male' as 'male' | 'female'
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetchPets();
  }, [fetchPets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.breed || !formData.age) return;

    setSubmitting(true);
    const data = new FormData();
    data.append('name', formData.name);
    data.append('species', formData.species);
    data.append('breed', formData.breed);
    data.append('age', formData.age);
    data.append('gender', formData.gender);
    if (avatarFile) {
      data.append('avatar', avatarFile);
    }

    const result = await addPet(data);
    setSubmitting(false);
    
    if (result) {
      setShowModal(false);
      setFormData({ name: '', species: 'cat', breed: '', age: '', gender: 'male' });
      setAvatarFile(null);
      setAvatarPreview('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleStatusChange = async (petId: string, newStatus: Pet['status']) => {
    setStatusUpdating(petId);
    await updatePetStatus(petId, newStatus);
    setStatusUpdating(null);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>我的宠物</h2>
        <button 
          style={styles.addButton}
          className="button-hover"
          onClick={() => setShowModal(true)}
        >
          <Plus size={20} style={{ marginRight: 8 }} />
          添加宠物
        </button>
      </div>

      {state.petsLoading && state.pets.length === 0 ? (
        <div style={styles.loading}>加载中...</div>
      ) : (
        <div style={styles.grid}>
          {state.pets.map((pet, index) => (
            <PetCard
              key={pet.id}
              pet={pet}
              index={index}
              onClick={() => navigate(`/pets/${pet.id}`)}
              onStatusChange={handleStatusChange}
              statusUpdating={statusUpdating === pet.id}
            />
          ))}
        </div>
      )}

      {state.pets.length === 0 && !state.petsLoading && (
        <div style={styles.empty}>
          <p style={styles.emptyText}>还没有添加宠物哦~</p>
          <p style={styles.emptySubtext}>点击上方按钮添加你的第一只毛孩子</p>
        </div>
      )}

      {showModal && (
        <div style={styles.modalOverlay} className="animate-fade-in">
          <div style={styles.modal} className="animate-slide-up">
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>添加新宠物</h3>
              <button style={styles.closeButton} onClick={() => setShowModal(false)}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.avatarUpload}>
                <div style={styles.avatarPreview}>
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="" style={styles.avatarImg} />
                  ) : (
                    <Upload size={32} color="#8D8D8D" />
                  )}
                </div>
                <label style={styles.uploadLabel}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  上传头像
                </label>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>宠物名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  style={styles.input}
                  placeholder="请输入宠物名称"
                  required
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>品种类型</label>
                  <select
                    value={formData.species}
                    onChange={e => setFormData({ ...formData, species: e.target.value as Pet['species'] })}
                    style={styles.select}
                  >
                    <option value="cat">猫咪</option>
                    <option value="dog">狗狗</option>
                    <option value="rabbit">兔子</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>性别</label>
                  <select
                    value={formData.gender}
                    onChange={e => setFormData({ ...formData, gender: e.target.value as 'male' | 'female' })}
                    style={styles.select}
                  >
                    <option value="male">男孩</option>
                    <option value="female">女孩</option>
                  </select>
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>品种</label>
                  <input
                    type="text"
                    value={formData.breed}
                    onChange={e => setFormData({ ...formData, breed: e.target.value })}
                    style={styles.input}
                    placeholder="如：英短蓝猫"
                    required
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>年龄</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={formData.age}
                    onChange={e => setFormData({ ...formData, age: e.target.value })}
                    style={styles.input}
                    placeholder="岁"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="button-hover"
                style={{
                  ...styles.submitButton,
                  opacity: submitting ? 0.6 : 1
                }}
              >
                {submitting ? '添加中...' : '添加宠物'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PetCard({ 
  pet, 
  index, 
  onClick, 
  onStatusChange,
  statusUpdating 
}: { 
  pet: Pet; 
  index: number;
  onClick: () => void;
  onStatusChange: (id: string, status: Pet['status']) => void;
  statusUpdating: boolean;
}) {
  const [showStatusBar, setShowStatusBar] = useState(false);

  const handleStatusClick = (e: React.MouseEvent, newStatus: Pet['status']) => {
    e.stopPropagation();
    if (pet.status !== newStatus && !statusUpdating) {
      setShowStatusBar(true);
      onStatusChange(pet.id, newStatus);
      setTimeout(() => setShowStatusBar(false), 500);
    }
  };

  const statusColor = pet.status === 'fostering' ? '#E67E22' : '#2ECC71';
  const statusLabel = pet.status === 'fostering' ? '托管中' : '在家';

  return (
    <div
      style={{
        ...styles.card,
        animationDelay: `${index * 0.1}s`
      }}
      className="animate-slide-up card-hover"
      onClick={onClick}
    >
      <div style={styles.cardHeader}>
        <div style={styles.avatarContainer}>
          <img
            src={pet.avatar}
            alt={pet.name}
            style={styles.cardAvatar}
            loading="lazy"
          />
          <span style={styles.speciesTag}>
            {SPECIES_LABELS[pet.species]}
          </span>
        </div>
      </div>

      <div style={styles.cardBody}>
        <h3 style={styles.petName}>{pet.name}</h3>
        <p style={styles.petInfo}>{pet.breed} · {pet.age}岁 · {pet.gender === 'male' ? '♂' : '♀'}</p>
      </div>

      <div style={styles.cardFooter}>
        <div style={{ ...styles.statusBadge, backgroundColor: statusColor + '20', color: statusColor }}>
          {statusLabel}
        </div>
        <div style={styles.statusButtons}>
          <button
            style={{
              ...styles.statusButton,
              backgroundColor: pet.status === 'home' ? '#2ECC71' : '#F5E6D3',
              color: pet.status === 'home' ? 'white' : '#6B4226'
            }}
            onClick={(e) => handleStatusClick(e, 'home')}
            disabled={statusUpdating}
            title="设为在家"
          >
            <Home size={16} />
          </button>
          <button
            style={{
              ...styles.statusButton,
              backgroundColor: pet.status === 'fostering' ? '#E67E22' : '#F5E6D3',
              color: pet.status === 'fostering' ? 'white' : '#6B4226'
            }}
            onClick={(e) => handleStatusClick(e, 'fostering')}
            disabled={statusUpdating}
            title="设为托管中"
          >
            <Briefcase size={16} />
          </button>
        </div>
      </div>

      {showStatusBar && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 4,
            backgroundColor: statusColor,
            borderRadius: '0 0 20px 20px',
            animation: 'statusBar 0.5s ease forwards'
          }}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32
  },
  title: {
    fontSize: 28,
    fontWeight: 600,
    color: '#3D2914',
    margin: 0
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 24px',
    backgroundColor: '#6B4226',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, 280px)',
    gap: 24,
    justifyContent: 'center'
  },
  loading: {
    textAlign: 'center',
    padding: '60px 0',
    color: '#8D8D8D',
    fontSize: 16
  },
  empty: {
    textAlign: 'center',
    padding: '80px 20px'
  },
  emptyText: {
    fontSize: 18,
    color: '#6B4226',
    marginBottom: 8
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8D8D8D'
  },
  card: {
    width: 280,
    height: 360,
    backgroundColor: '#FFFCF7',
    borderRadius: 20,
    boxShadow: '0 2px 12px rgba(107, 66, 38, 0.08)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    opacity: 0
  },
  cardHeader: {
    padding: 16,
    position: 'relative'
  },
  avatarContainer: {
    position: 'relative',
    width: 80,
    height: 80
  },
  cardAvatar: {
    width: 80,
    height: 80,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid white',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  speciesTag: {
    position: 'absolute',
    bottom: -4,
    right: -8,
    padding: '4px 12px',
    backgroundColor: '#6B4226',
    color: 'white',
    fontSize: 11,
    borderRadius: 12,
    fontWeight: 500
  },
  cardBody: {
    padding: '8px 20px 20px',
    flex: 1
  },
  petName: {
    fontSize: 22,
    fontWeight: 600,
    color: '#3D2914',
    marginBottom: 8
  },
  petInfo: {
    fontSize: 14,
    color: '#8D8D8D',
    margin: 0
  },
  cardFooter: {
    padding: '16px 20px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: '1px solid rgba(107, 66, 38, 0.08)'
  },
  statusBadge: {
    padding: '6px 14px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 500
  },
  statusButtons: {
    display: 'flex',
    gap: 6
  },
  statusButton: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(61, 41, 20, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20
  },
  modal: {
    backgroundColor: '#FFFCF7',
    borderRadius: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid rgba(107, 66, 38, 0.1)'
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: '#3D2914',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#8D8D8D',
    padding: 4,
    borderRadius: 8,
    transition: 'all 0.2s ease'
  },
  form: {
    padding: 24
  },
  avatarUpload: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 24
  },
  avatarPreview: {
    width: 100,
    height: 100,
    borderRadius: '50%',
    backgroundColor: '#F5E6D3',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 12
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  uploadLabel: {
    padding: '8px 20px',
    backgroundColor: '#F5E6D3',
    color: '#6B4226',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  formGroup: {
    marginBottom: 16,
    flex: 1
  },
  formRow: {
    display: 'flex',
    gap: 16
  },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: '#3D2914',
    marginBottom: 8
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    border: '1px solid rgba(107, 66, 38, 0.2)',
    borderRadius: 10,
    fontSize: 15,
    backgroundColor: 'white',
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif'
  },
  select: {
    width: '100%',
    padding: '12px 16px',
    border: '1px solid rgba(107, 66, 38, 0.2)',
    borderRadius: 10,
    fontSize: 15,
    backgroundColor: 'white',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif'
  },
  submitButton: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#6B4226',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: 8,
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif'
  }
};

export default PetProfile;
