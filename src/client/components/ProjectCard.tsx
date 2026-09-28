import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface ProjectCardProps {
  project: any;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState<string>('');
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date().getTime();
      const deadline = new Date(project.deadline).getTime();
      const distance = deadline - now;

      if (distance < 0) {
        setIsExpired(true);
        setCountdown('已截止');
        return;
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setCountdown(`剩${days}天${hours}时`);
      } else if (hours > 0) {
        setCountdown(`剩${hours}时${minutes}分`);
      } else {
        setCountdown(`剩${minutes}分`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 60000);
    return () => clearInterval(timer);
  }, [project.deadline]);

  const handleClick = () => {
    navigate(`/projects/${project.id}`);
  };

  return (
    <div 
      className={`project-card ${isExpired ? 'expired' : ''}`}
      onClick={handleClick}
    >
      <span className={`project-type-tag type-${project.type}`}>{project.type}</span>
      <h3>{project.name}</h3>
      <div className="project-meta">
        <span className="project-meta-item">📍 {project.location}</span>
        <span className="project-meta-item">📅 {project.serviceDate}</span>
        <span className="project-meta-item">🕐 {project.startTime}-{project.endTime}</span>
      </div>
      <div className="project-status">
        <span className="remaining-slots">
          剩余名额: {project.remainingSlots}/{project.maxVolunteers}
        </span>
        <span className={`countdown ${isExpired ? 'expired-text' : ''}`}>
          {countdown}
        </span>
      </div>
    </div>
  );
};

export default ProjectCard;
