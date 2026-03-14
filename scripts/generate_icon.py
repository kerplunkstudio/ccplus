#!/usr/bin/env python3
"""
Generate CC+ app icon with stacked C's and overlaid + design.

Creates a rounded rectangle icon with two vertically stacked C characters
(back C dimmer for depth) and a bold + accent overlaid in the center-right.
Outputs PNGs at all required sizes and prepares an .iconset for macOS.
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# Color scheme: refined developer tool aesthetic
BG_COLOR = "#1a1614"      # Deep warm charcoal
TEXT_COLOR = "#f5f0e8"    # Warm off-white for "CC"
PLUS_COLOR = "#e8a84c"    # Warm amber/gold for "+"
BORDER_COLOR = "#2a2624"  # Subtle lighter border

# Icon sizes for macOS .icns
ICON_SIZES = [16, 32, 64, 128, 256, 512, 1024]

# Icon shape: rounded rectangle with ~22% corner radius
CORNER_RADIUS_RATIO = 0.22


def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def create_rounded_rectangle(size, radius, fill_color, border_color=None, border_width=1):
    """Create a rounded rectangle image with optional border."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw filled rounded rectangle
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=radius,
        fill=hex_to_rgb(fill_color)
    )

    # Draw border if specified
    if border_color:
        draw.rounded_rectangle(
            [(0, 0), (size - 1, size - 1)],
            radius=radius,
            outline=hex_to_rgb(border_color),
            width=border_width
        )

    return img


def find_system_font(size):
    """Find and load the best available bold sans-serif font."""
    # Try fonts in order of preference
    font_paths = [
        "/System/Library/Fonts/SFCompact.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ]

    for font_path in font_paths:
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, size)
            except Exception:
                continue

    # Fallback to default
    try:
        return ImageFont.truetype("Helvetica", size)
    except Exception:
        # Last resort: use PIL default
        return ImageFont.load_default()


def draw_text_centered(draw, text, font, position, fill_color):
    """Draw text centered at the given position."""
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = position[0] - text_width // 2
    y = position[1] - text_height // 2

    draw.text((x, y), text, font=font, fill=hex_to_rgb(fill_color))


def generate_icon(size):
    """Generate a single icon at the specified size."""
    corner_radius = int(size * CORNER_RADIUS_RATIO)

    # Create rounded rectangle background
    img = create_rounded_rectangle(
        size,
        corner_radius,
        BG_COLOR,
        border_color=BORDER_COLOR,
        border_width=max(1, size // 512)  # Scale border width
    )

    draw = ImageDraw.Draw(img)

    # Calculate font sizes for stacked C's and overlaid +
    c_font_size = int(size * 0.40)  # Large, bold C's
    plus_font_size = int(size * 0.35)  # Bold + accent

    # Load fonts
    c_font = find_system_font(c_font_size)
    plus_font = find_system_font(plus_font_size)

    # Measure single "C" character
    c_bbox = draw.textbbox((0, 0), "C", font=c_font)
    c_width = c_bbox[2] - c_bbox[0]
    c_height = c_bbox[3] - c_bbox[1]

    # Calculate vertical spacing for stacked C's (tight overlap)
    vertical_spacing = int(c_height * 0.75)  # Tight vertical stack
    total_height = c_height + vertical_spacing

    # Center the stacked C's vertically
    center_x = size // 2
    start_y = (size - total_height) // 2

    # Position for back C (top, slightly transparent for depth)
    back_c_y = start_y + c_height // 2

    # Position for front C (bottom)
    front_c_y = start_y + vertical_spacing + c_height // 2

    # Draw back C (dimmer, creates depth)
    back_c_color = hex_to_rgb(TEXT_COLOR) + (180,)  # 70% opacity
    img_with_alpha = img.convert('RGBA')
    draw_alpha = ImageDraw.Draw(img_with_alpha)

    # Draw back C with transparency
    back_c_x = center_x - c_width // 2
    back_c_draw_y = back_c_y - c_height // 2
    draw_alpha.text((back_c_x, back_c_draw_y), "C", font=c_font, fill=back_c_color)

    # Draw front C (full opacity)
    front_c_x = center_x - c_width // 2
    front_c_draw_y = front_c_y - c_height // 2
    front_c_color = hex_to_rgb(TEXT_COLOR) + (255,)
    draw_alpha.text((front_c_x, front_c_draw_y), "C", font=c_font, fill=front_c_color)

    # Position + in center-right area (where C's opening faces)
    plus_bbox = draw_alpha.textbbox((0, 0), "+", font=plus_font)
    plus_width = plus_bbox[2] - plus_bbox[0]
    plus_height = plus_bbox[3] - plus_bbox[1]

    # Place + to the right of center, vertically centered on the composition
    plus_x = center_x + int(c_width * 0.15)  # Slightly right of center
    plus_y = size // 2 - plus_height // 2

    plus_color = hex_to_rgb(PLUS_COLOR) + (255,)
    draw_alpha.text((plus_x, plus_y), "+", font=plus_font, fill=plus_color)

    return img_with_alpha


def main():
    """Generate all icon sizes and create .iconset directory."""
    # Setup paths
    project_root = Path(__file__).parent.parent
    iconset_dir = project_root / "ccplus.iconset"
    iconset_dir.mkdir(exist_ok=True)

    print(f"Generating CC+ app icons...")
    print(f"Output directory: {iconset_dir}")
    print()

    # Generate all sizes
    for size in ICON_SIZES:
        # Standard resolution
        img = generate_icon(size)
        filename = f"icon_{size}x{size}.png"
        filepath = iconset_dir / filename
        img.save(filepath, "PNG")
        print(f"✓ Generated {filename}")

        # @2x resolution (for Retina displays)
        if size <= 512:  # macOS .icns convention
            retina_size = size * 2
            img_retina = generate_icon(retina_size)
            filename_retina = f"icon_{size}x{size}@2x.png"
            filepath_retina = iconset_dir / filename_retina
            img_retina.save(filepath_retina, "PNG")
            print(f"✓ Generated {filename_retina}")

    print()
    print(f"Icon generation complete!")
    print(f"Next step: Run 'iconutil -c icns {iconset_dir}'")


if __name__ == "__main__":
    main()
