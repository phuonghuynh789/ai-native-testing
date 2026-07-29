interface ScreenplayHeaderProps {
  actorName: string;
  onActorNameChange: (value: string) => void;
  taskName: string;
  onTaskNameChange: (value: string) => void;
  actorOptions: string[];
  taskOptions: string[];
}

export function ScreenplayHeader({
  actorName,
  onActorNameChange,
  taskName,
  onTaskNameChange,
  actorOptions,
  taskOptions,
}: ScreenplayHeaderProps) {
  return (
    <section className="row">
      <label className="label">
        Actor
        <input
          className="text-input"
          list="actor-options"
          value={actorName}
          onChange={(e) => onActorNameChange(e.target.value)}
        />
        <datalist id="actor-options">
          {actorOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>
      <label className="label">
        Task
        <input
          className="text-input"
          list="task-options"
          value={taskName}
          onChange={(e) => onTaskNameChange(e.target.value)}
        />
        <datalist id="task-options">
          {taskOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>
    </section>
  );
}
