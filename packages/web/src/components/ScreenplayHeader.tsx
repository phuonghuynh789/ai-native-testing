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
    <section className="row">
      <label className="label">
        Actor
        <input
          className="text-input"
          value={actorName}
          onChange={(e) => onActorNameChange(e.target.value)}
        />
      </label>
      <label className="label">
        Task
        <input
          className="text-input"
          value={taskName}
          onChange={(e) => onTaskNameChange(e.target.value)}
        />
      </label>
    </section>
  );
}
