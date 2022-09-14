/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 * @author jihad
 */
public abstract class Item {

    String itemName, itemRarity;
    //cost of item will be slightly variable internally, but character Charisma will also influence on price
    int itemCost, itemRarityWeight;
    //0 armor, 1 weapon, 2 trinket, 3 usable (includes instant damage items for example)

// ARMOR   int itemAC, itemACM; //armor class of the item, armor class modifier (can be only based on dex until now)
// WEAPONS   Dice itemAtkRoll; //this is a dice for the atk roll, used for weapons
// WEAPONS   String itemProperty; //melee, ranged, finesse

    public Item(String itemName, int itemCost, String itemRarity) {
        this.itemName = itemName;
        this.itemCost = itemCost;
        this.itemRarity = itemRarity;
    }
}
