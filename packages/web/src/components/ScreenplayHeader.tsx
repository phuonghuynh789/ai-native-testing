interface ScreenplayHeaderProps {
  actorName: string;
  onActorNameChange: (value: string) => void;
  taskName: string;
  onTaskNameChange: (value: string) => void;
}

export function ScreenplayHeader({
  actorName,
  onActorNameChange,
  taskName,
  onTaskNameChange,
}: ScreenplayHeaderProps) {
  return (
    <section>
      <label>
        Actor
        <input value={actorName} onChange={(e) => onActorNameChange(e.target.value)} />
      </label>
      <label>
        Task
        <input value={taskName} onChange={(e) => onTaskNameChange(e.target.value)} />
      </label>
    </section>
  );
}
