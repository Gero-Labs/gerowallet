import { ref } from 'vue';

/**
 * Composable for 3D card mouse interaction effects
 * Provides mouse move and leave handlers with configurable sensitivity
 */
export function use3DCard(sensitivity = 10) {
  const cardStyle = ref({
    transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
    transition: 'transform 0.3s ease-out'
  });

  const handleCardMouseMove = (event: MouseEvent) => {
    const card = event.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = (y - centerY) / sensitivity;
    const rotateY = (centerX - x) / sensitivity;

    cardStyle.value = {
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`,
      transition: 'transform 0.1s ease-out'
    };
  };

  const handleCardMouseLeave = () => {
    cardStyle.value = {
      transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
      transition: 'transform 0.3s ease-out'
    };
  };

  return {
    cardStyle,
    handleCardMouseMove,
    handleCardMouseLeave
  };
}