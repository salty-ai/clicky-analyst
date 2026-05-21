type ModelPickerProps = {
  selectedModel: string;
  onSelectModel: (model: string) => void;
};

const models = [
  { label: "Mini", value: "openai/gpt-5.4-mini" },
  { label: "Pro", value: "openai/gpt-5.4" }
];

export function ModelPicker({ selectedModel, onSelectModel }: ModelPickerProps) {
  return (
    <div className="model-picker">
      <span className="permission-label">Model</span>
      <div className="model-segment">
        {models.map((model) => (
          <button
            className="model-option"
            data-selected={selectedModel === model.value}
            key={model.value}
            type="button"
            onClick={() => onSelectModel(model.value)}
          >
            {model.label}
          </button>
        ))}
      </div>
    </div>
  );
}
