import { Modal } from "antd";
import { useStore } from "../store/useStore";
import { CategoryId } from "../types";

export default function ManageCategoryModal({
  boardId,
  open,
  onClose,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
}) {
  const board = useStore((s) => s.boards.find((b) => b.id === boardId));
  const categories = useStore((s) => s.categories);
  const toggle = useStore((s) => s.toggleBoardCategory);
  if (!board) return null;

  return (
    <Modal
      title={`管理「${board.name}」画板的品类`}
      open={open}
      onCancel={onClose}
      footer={null}
      centered
    >
      <div className="pb-1 pt-1 text-t6 text-warmgray">
        勾选即加入该画板，取消则移出
      </div>
      <div className="flex flex-wrap gap-2 pt-3">
        {categories.map((c: CategoryId) => {
          const active = board.categories.includes(c);
          return (
            <button
              key={c}
              onClick={() => toggle(boardId, c)}
              className={[
                "rounded-[14px] px-3 py-1.5 text-t4 font-semibold transition-colors",
                active
                  ? "bg-mint text-white"
                  : "border border-border bg-white text-brown hover:bg-mint-soft/50",
              ].join(" ")}
            >
              {c}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
